import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import Header from '../components/Header';

const PAGE_SIZE = 20;

export default function MembersList() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (currentPage, currentSearch) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(PAGE_SIZE),
        search: currentSearch
      });
      const result = await apiFetch(`/members?${params.toString()}`);
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search);
  }, [load, page, search]);

  async function handleDelete(memberId) {
    if (!window.confirm(`Delete member ${memberId}?`)) return;
    try {
      await apiFetch(`/members/${memberId}`, { method: 'DELETE' });
      load(page, search);
    } catch (err) {
      setError(err.message);
    }
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <>
      <Header />
      <div className="container">
        <div className="toolbar">
          <h2>Union Members</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              className="search-input"
              placeholder="Search by name..."
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            />
            <Link to="/members/new"><button>Add Member</button></Link>
          </div>
        </div>
        <div className="card">
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
                    <th>ID</th><th>Name</th><th>Officer</th><th>Phone</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m) => (
                    <tr key={m.memberId}>
                      <td>{m.memberId}</td>
                      <td>{m.memberName}</td>
                      <td>{m.officerName || '—'}</td>
                      <td>{m.phone || '—'}</td>
                      <td className="actions">
                        <Link to={`/members/${m.memberId}/edit`}><button className="secondary">Edit</button></Link>
                        <button className="danger" onClick={() => handleDelete(m.memberId)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pagination">
                <button className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <span>Page {page} of {totalPages}</span>
                <button className="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
