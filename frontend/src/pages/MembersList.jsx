import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZE = 20;

export default function MembersList() {
  const { logout } = useAuth();
  const navigate = useNavigate();
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

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="container">
      <div className="topbar">
        <h2>Union Members</h2>
        <div>
          <Link to="/members/new"><button>Add Member</button></Link>{' '}
          <button className="secondary" onClick={handleLogout}>Log Out</button>
        </div>
      </div>
      <div className="card">
        <input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }}
        />
        {error && <div className="error">{error}</div>}
        {loading ? (
          <div>Loading...</div>
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
                    <td>{m.officerName || '-'}</td>
                    <td>{m.phone || '-'}</td>
                    <td className="actions">
                      <Link to={`/members/${m.memberId}/edit`}><button>Edit</button></Link>
                      <button className="danger" onClick={() => handleDelete(m.memberId)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12 }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>{' '}
              <span>Page {page} of {totalPages}</span>{' '}
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
