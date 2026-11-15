import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search, Users, UserCog, Eye, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../api/client';
import { money, STATUS_LABEL } from '../api/format';
import Layout from '../components/Layout';

const PAGE_SIZE = 20;

function initial(name) {
  const m = (name || '').match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : '#';
}

export default function MembersList() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [officerCount, setOfficerCount] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('name');
  const [suffix, setSuffix] = useState('');
  const [suffixes, setSuffixes] = useState([]);

  const load = useCallback(async (currentPage, currentSearch, from, to, yr, st, so, sf) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(PAGE_SIZE),
        search: currentSearch,
        year: String(yr)
      });
      if (st) params.set('status', st);
      if (from) params.set('dateFrom', from);
      if (to) params.set('dateTo', to);
      if (so && so !== 'name') params.set('sort', so);
      if (sf) params.set('suffix', sf);
      const result = await apiFetch(`/members?${params.toString()}`);
      setItems(result.items);
      setTotal(result.total);
      setSuffixes(result.idSuffixes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search, dateFrom, dateTo, year, status, sort, suffix);
  }, [load, page, search, dateFrom, dateTo, year, status, sort, suffix]);

  useEffect(() => {
    apiFetch('/officers').then((data) => setOfficerCount(data.length)).catch(() => setOfficerCount(null));
  }, []);

  async function handleDelete(memberId) {
    if (!window.confirm(`Delete member ${memberId}?`)) return;
    try {
      await apiFetch(`/members/${memberId}`, { method: 'DELETE' });
      load(page, search, dateFrom, dateTo, year, status, sort, suffix);
    } catch (err) {
      setError(err.message);
    }
  }

  function clearFilters() {
    setPage(1); setSearch(''); setStatus(''); setDateFrom(''); setDateTo(''); setSort('name'); setSuffix('');
    setYear(new Date().getFullYear());
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const filtered = Boolean(search || status || dateFrom || dateTo || suffix || sort !== 'name' || year !== new Date().getFullYear());

  return (
    <Layout>
      <div className="container">
        <div className="page-head">
          <div>
            <h2>Members</h2>
            <div className="muted">Search, filter and manage everyone in the samithiya</div>
          </div>
          <Link to="/members/new">
            <button><Plus size={16} /> Add Member</button>
          </Link>
        </div>

        <div className="stat-row">
          <div className="stat-card">
            <div className="stat-icon stat-icon-accent"><Users size={20} /></div>
            <div>
              <div className="stat-value">{total}</div>
              <div className="stat-label">{filtered ? 'Matching members' : 'Total members'}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-icon-muted"><UserCog size={20} /></div>
            <div>
              <div className="stat-value">{officerCount ?? '—'}</div>
              <div className="stat-label">Collecting officers</div>
            </div>
          </div>
        </div>

        <div className="card filter-bar">
          <div className="filter-field filter-search">
            <label>Search</label>
            <div className="search-wrap">
              <Search size={16} className="search-icon" />
              <input
                className="search-input"
                placeholder="Name or member ID…"
                value={search}
                onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              />
            </div>
          </div>
          <div className="filter-field">
            <label>Year</label>
            <input type="number" min="2000" max="2100" value={year}
              onChange={(e) => { setPage(1); setYear(Number(e.target.value) || new Date().getFullYear()); }} />
          </div>
          <div className="filter-field">
            <label>Sort by</label>
            <select value={sort} onChange={(e) => { setPage(1); setSort(e.target.value); }}>
              <option value="name">Name (A–Z)</option>
              <option value="id_asc">Member ID — ascending</option>
              <option value="id_desc">Member ID — descending</option>
            </select>
          </div>
          <div className="filter-field">
            <label>ID letter</label>
            <select value={suffix} onChange={(e) => { setPage(1); setSuffix(e.target.value); }}>
              <option value="">All</option>
              {suffixes.map((s) => (
                <option key={s} value={s}>{s === 'none' ? 'No letter (e.g. 364)' : `Ends with ${s} (e.g. 364${s})`}</option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>Payment status</label>
            <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              <option value="">All</option>
              <option value="UNPAID">Not paid</option>
              <option value="PARTIAL">Partly paid</option>
              <option value="PAID">Fully paid</option>
            </select>
          </div>
          <div className="filter-field">
            <label>Updated from</label>
            <input type="date" value={dateFrom} max={dateTo || undefined}
              onChange={(e) => { setPage(1); setDateFrom(e.target.value); }} />
          </div>
          <div className="filter-field">
            <label>Updated to</label>
            <input type="date" value={dateTo} min={dateFrom || undefined}
              onChange={(e) => { setPage(1); setDateTo(e.target.value); }} />
          </div>
          {filtered && (
            <div className="filter-field filter-clear">
              <button className="secondary" onClick={clearFilters}><X size={14} /> Clear</button>
            </div>
          )}
        </div>

        <div className="card table-card">
          {error && <div className="error">{error}</div>}
          {loading ? (
            <div className="loading-state">Loading members…</div>
          ) : items.length === 0 ? (
            <div className="empty-state">No members found.</div>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Member</th><th>Officer</th><th>Phone</th><th>{year} payments</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m) => (
                    <tr key={m.memberId}>
                      <td>
                        <div className="cell-user">
                          <span className="avatar">{initial(m.memberName)}</span>
                          <div>
                            <div className="cell-title">{m.memberName}</div>
                            <span className="id-tag">{m.memberId}</span>
                          </div>
                        </div>
                      </td>
                      <td>{m.officerName || '—'}</td>
                      <td>{m.phone || '—'}</td>
                      <td>
                        <span className={`badge badge-${m.yearStatus.toLowerCase()}`}>{STATUS_LABEL[m.yearStatus]}</span>
                        {m.yearDue > 0 && <div className="muted">owes {money(m.yearDue)}</div>}
                        {!m.isActive && <span className="badge badge-unpaid" style={{ marginTop: 4 }}>Inactive</span>}
                      </td>
                      <td className="actions">
                        <Link to={`/members/${m.memberId}`}>
                          <button title="View member"><Eye size={14} /> View</button>
                        </Link>
                        <Link to={`/members/${m.memberId}/edit`}>
                          <button className="secondary icon-only" title="Edit member" aria-label="Edit member"><Pencil size={14} /></button>
                        </Link>
                        <button className="danger icon-only" title="Delete member" aria-label="Delete member"
                          onClick={() => handleDelete(m.memberId)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pagination">
                <span>Showing {from}–{to} of {total}</span>
                <div className="pagination-btns">
                  <button className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft size={14} /> Previous
                  </button>
                  <span>Page {page} of {totalPages}</span>
                  <button className="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
