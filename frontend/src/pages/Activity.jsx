import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client';
import Layout from '../components/Layout';

const ENTITIES = [
  ['', 'Everything'], ['payment', 'Payments'], ['rental', 'Rentals'], ['member', 'Members'],
  ['death_benefit', 'Death benefits'], ['expense', 'Expenses'], ['settings', 'Fees'],
  ['receipt_book', 'Receipt books'], ['equipment', 'Equipment'], ['user', 'Logins and passwords']
];

const LABEL = {
  create_payment: 'Payment recorded', void_payment: 'Payment voided', create_rental: 'Rental given out',
  return_rental: 'Rental returned', void_rental: 'Rental voided', delete_member: 'Member deleted',
  record_death: 'Death recorded', reverse_death: 'Death reversed', create_expense: 'Expense added',
  delete_expense: 'Expense deleted', update_fees: 'Fees changed', create_receipt_book: 'Receipt book issued',
  delete_receipt_book: 'Receipt book deleted', update_equipment: 'Equipment edited',
  delete_equipment: 'Equipment deleted', login: 'Logged in', change_password: 'Password changed'
};

function summary(d) {
  if (!d) return '';
  if (d.reason) return `Reason: ${d.reason}`;
  const pick = ['receiptNo', 'memberId', 'total', 'amount', 'qty', 'category', 'fromYear'];
  return pick.filter((k) => d[k] !== undefined).map((k) => `${k}: ${d[k]}`).join(' · ');
}

export default function Activity() {
  const [rows, setRows] = useState([]);
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ limit: '300' });
      if (entity) p.set('entity', entity);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      setRows(await apiFetch(`/audit?${p.toString()}`));
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [entity, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <Layout>
      <div className="container">
        <div className="page-head">
          <div>
            <h2>Activity</h2>
            <div className="muted">Who did what. Every payment, void, fee change and deletion is recorded here.</div>
          </div>
        </div>

        <div className="card filter-bar">
          <div className="filter-field">
            <label>Show</label>
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="filter-field"><label>From</label>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="filter-field"><label>To</label>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></div>
        </div>

        <div className="card table-card">
          {error && <div className="error">{error}</div>}
          {loading ? <div className="loading-state">Loading activity…</div>
            : rows.length === 0 ? <div className="empty-state">Nothing recorded yet.</div> : (
              <table>
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.auditId}>
                      <td>{new Date(r.at).toLocaleString()}</td>
                      <td>{r.username || '—'}</td>
                      <td>
                        <strong>{LABEL[r.action] || r.action}</strong>
                        <div className="muted">{r.entity}{r.entityId ? ` #${r.entityId}` : ''}</div>
                      </td>
                      <td>
                        {summary(r.details) && <div>{summary(r.details)}</div>}
                        {r.details && (
                          <details>
                            <summary className="muted">Full record</summary>
                            <pre className="audit-json">{JSON.stringify(r.details, null, 2)}</pre>
                          </details>
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
