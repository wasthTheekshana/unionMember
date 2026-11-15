# Union Members (samithiya) - deploy on the DOK Docker server

Server: application-docker-server, 34.93.171.14. Stack folder: `~/samithiya-stack`.
Run every command below from that folder unless a `cd` says otherwise.

What this creates (no host ports are published, the database is never on shared-nginx):

| Container | Image | Job | Limits |
|-----------|-------|-----|--------|
| samithiya-db | postgres:16-alpine | database, data on `/mnt/disks/data/db/samithiya` | 1 CPU, 2 GB |
| samithiya-migrate | built from this repo | one-shot: creates/upgrades tables, then exits | 0.5 CPU, 512 MB |
| samithiya-app | built from this repo | API + web pages on port 3000 (expose only) | 1 CPU, 1 GB |

About 2.5 CPU and 3 GB at most, well inside the free headroom.

## 1. Before you start

- DNS: an A record for `union.testsys.shop` pointing to 34.93.171.14. Check with `nslookup union.testsys.shop`.
- Take the member CSV off the old machine. It is NOT in the image on purpose (personal data).
  Re-export `UNION_Members.csv` as UTF-8: the current file has 118 names that are already
  question marks, so Sinhala text must be fixed at the source before importing.

## 2. Get the code

```
cd ~
git clone <repo-url> samithiya-stack
cd ~/samithiya-stack
```

## 3. Create .env

```
cp .env.docker.example .env
openssl rand -base64 24
openssl rand -hex 48
nano .env
```

Put the first random value in `POSTGRES_PASSWORD` and the second in `JWT_SECRET`.
`.env` is never committed. Do not paste its values in chats or logs.

## 4. Data folder on the data disk

```
findmnt /mnt/disks/data
grep disks/data /etc/fstab
docker run --rm postgres:16-alpine id postgres
sudo mkdir -p /mnt/disks/data/db/samithiya
sudo chown -R 70:70 /mnt/disks/data/db/samithiya
df -h /mnt/disks/data
```

`findmnt` must print the mount and the fstab line must contain `nofail`. If the disk is
not mounted, stop: Postgres would otherwise start on an empty folder of the boot disk.
The `id postgres` line must say uid=70 (the alpine image).

## 5. Start

```
docker compose up -d --build
docker compose ps
docker compose logs --tail=30 migrate
docker compose logs --tail=30 app
docker stats --no-stream
```

`samithiya-db` and `samithiya-app` must show healthy and `samithiya-migrate` must have exited
with the "Schema setup complete" line. The `shared-nginx` network must already exist
(it is created by `~/dok-stack`).

## 6. First admin user and the member data

```
docker compose run --rm -e ADMIN_PASSWORD='<at least 10 characters>' app node src/scripts/seed-admin.js --username admin
docker compose run --rm -v ~/UNION_Members.csv:/UNION_Members.csv:ro app node src/scripts/import-csv.js
```

Copy `UNION_Members.csv` to the server home folder first. The import can be run again safely.
After the first login open Account in the app and set your own password.

## 7. SSL certificate

Use the standard shared certbot command from the DOK deployment rules, for `union.testsys.shop`:

```
docker run --rm -it -v ~/dok-stack/certbot/conf:/etc/letsencrypt -v ~/dok-stack/certbot/www:/var/www/certbot certbot/certbot certonly --manual --preferred-challenges dns --email wasath@doksolutions.lk --agree-tos --no-eff-email -d union.testsys.shop
```

Add the TXT record, verify it on 8.8.8.8, 1.1.1.1 and 9.9.9.9, wait about 10 minutes, then
press Enter. Check the real folder name under `~/dok-stack/certbot/conf/live/`.
Set a calendar reminder: the certificate expires in 90 days.

## 8. nginx

```
nano ~/dok-stack/nginx/nginx.conf
```

Paste both server blocks from `deploy/dok/nginx-server-block.conf` (already set for `union.testsys.shop`), then:

```
cd ~/dok-stack
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

A 502 right after recreating the app means nginx holds a stale address: reload it again.

## 9. Check it works

- Open https://union.testsys.shop : padlock, login page, log in as admin.
- Dashboard loads. Add one test payment with a receipt book, then void it (a reason is asked).
- Activity page shows the entries.
- `docker compose logs --tail=50 app` shows no errors.

## 10. Backups (do not skip)

```
mkdir -p /mnt/disks/data/backups
docker exec samithiya-db sh -c 'pg_dump -U samithiya -d samithiya' | gzip > /mnt/disks/data/backups/samithiya-$(date +%F).sql.gz
ls -lh /mnt/disks/data/backups
```

Nightly at 02:30 (open with `crontab -e`, one line):

```
30 2 * * * docker exec samithiya-db sh -c 'pg_dump -U samithiya -d samithiya' | gzip > /mnt/disks/data/backups/samithiya-$(date +\%F).sql.gz && find /mnt/disks/data/backups -name 'samithiya-*.sql.gz' -mtime +30 -delete
```

Test a restore once into a scratch database before you rely on it.
Add an Uptime Kuma monitor on `https://union.testsys.shop/api/health`.

## 11. Updating after a push to main

```
cd ~/samithiya-stack
git status
git pull origin main
git log -1 --oneline
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 app
cd ~/dok-stack
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

`up -d --build` re-runs the migrate job first, so database changes are applied before the
new app starts. `.env` is not in git, so a pull never touches it. Run `docker image prune -f`
now and then to protect the boot disk.

## Before you go live

- [ ] `.env` has a random `POSTGRES_PASSWORD` and `JWT_SECRET` (the app refuses to start in
      production with a short or placeholder `JWT_SECRET`).
- [ ] Do not reuse any password that has ever appeared in this repository or its git history
      (an old version of the earlier deploy guide contained a database password). Generate new ones.
- [ ] The admin password is not a default one; set your own on the Account page after first login.
- [ ] HTTPS works for `union.testsys.shop` (padlock) and http redirects to https.
- [ ] A backup file exists in `/mnt/disks/data/backups` and a restore was tried once.
- [ ] Never run the test suite (`npm test`) against this database: the tests create and delete rows.
      The test runner refuses to start when `backend/.env` says `NODE_ENV=production`.
- [ ] Look at the Activity page now and then: every payment, void, fee change and deletion is
      recorded there with who did it.

## Security notes specific to this app

- The app container is unprivileged (uid 1000), has no published port, no docker.sock and
  no writable data folder. It stores no uploads.
- The database is only on the internal `samithiya-app-net` network.
- Login: a username is locked out after 5 failures in 15 minutes. The container is told to
  trust nginx's X-Forwarded-For (`TRUST_PROXY`), so the lock applies per real client address.
- If the admin is ever locked out (too many wrong passwords, or someone tried to lock the
  account on purpose), wait 15 minutes, or clear it at once. The counters live in memory:

  ```
  cd ~/samithiya-stack
  docker compose restart app
  ```
- Every payment, void, fee change and deletion is written to the Activity log.
- UFW is inactive on this server. Do not enable it casually (no console fallback if SSH is
  blocked); flag it if a change depends on it.
