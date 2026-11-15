import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Save, X } from 'lucide-react';
import { money } from '../api/format';
import { apiFetch } from '../api/client';
import Layout from '../components/Layout';

export default function Officers() {
  const [officers, setOfficers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setOfficers(await apiFetch('/officers'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError('');
    setAdding(true);
    try {
      await apiFetch('/officers', { method: 'POST', body: JSON.stringify({ officerName: newName }) });
      setNewName('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(officer) {
    setError('');
    setEditingId(officer.officerId);
    setEditName(officer.officerName);
  }

  async function handleSave(officerId) {
    setError('');
    setSaving(true);
    try {
      await apiFetch(`/officers/${officerId}`, {
        method: 'PUT',
        body: JSON.stringify({ officerName: editName })
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div className="container">
        <div className="toolbar">
          <h2>Collecting Officers</h2>
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              placeholder="New officer name..."
              value={newName}
              style={{ marginBottom: 0 }}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" disabled={adding || !newName.trim()}>
              <Plus size={16} /> {adding ? 'Adding...' : 'Add Officer'}
            </button>
          </form>
        </div>
        <div className="card">
          {error && <div className="error">{error}</div>}
          {loading ? (
            <div className="loading-state">Loading officers…</div>
          ) : officers.length === 0 ? (
            <div className="empty-state">No officers yet.</div>
          ) : (
            <table>
              <thead>
                <tr><th>ID</th><th>Name</th><th>Members</th><th>Receipts left</th><th>Collected</th><th></th></tr>
              </thead>
              <tbody>
                {officers.map((o) => (
                  <tr key={o.officerId}>
                    <td>{o.officerId}</td>
                    <td>
                      {editingId === o.officerId ? (
                        <input
                          autoFocus
                          value={editName}
                          style={{ marginBottom: 0 }}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSave(o.officerId);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                      ) : (
                        <Link to={`/officers/${o.officerId}`}>{o.officerName}</Link>
                      )}
                    </td>
                    <td>{o.memberCount}</td>
                    <td>{o.receiptsRemaining}</td>
                    <td>{money(o.collectedTotal)}</td>
                    <td className="actions">
                      {editingId === o.officerId ? (
                        <>
                          <button disabled={saving || !editName.trim()} onClick={() => handleSave(o.officerId)}>
                            <Save size={14} /> Save
                          </button>
                          <button className="secondary" onClick={() => setEditingId(null)}>
                            <X size={14} /> Cancel
                          </button>
                        </>
                      ) : (
                        <button className="secondary" onClick={() => startEdit(o)}>
                          <Pencil size={14} /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
