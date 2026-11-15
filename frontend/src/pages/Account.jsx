import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';

export default function Account() {
  const { replaceToken } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setDone(false);
    if (form.newPassword.length < 10) { setError('The new password must be at least 10 characters.'); return; }
    if (form.newPassword !== form.confirm) { setError('The two new passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      });
      replaceToken(res.token); // other sessions are signed out; this one continues
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout>
      <div className="container">
        <div className="page-head">
          <div>
            <h2>Account</h2>
            <div className="muted">Change your password. Everywhere else you are logged in is signed out.</div>
          </div>
        </div>
        <form className="card" style={{ maxWidth: 520 }} onSubmit={submit}>
          {error && <div className="error">{error}</div>}
          {done && <div className="notice">Password changed. Other sessions have been signed out.</div>}
          <label>Current password</label>
          <input type="password" autoComplete="current-password" required value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          <label>New password (at least 10 characters)</label>
          <input type="password" autoComplete="new-password" required minLength={10} value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          <label>Repeat the new password</label>
          <input type="password" autoComplete="new-password" required value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          <div className="form-actions">
            <button type="submit" disabled={busy}><KeyRound size={16} /> {busy ? 'Saving…' : 'Change password'}</button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
