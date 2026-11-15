import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../api/client';
import { money } from '../api/format';
import Layout from '../components/Layout';

export default function OfficerDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [startNo, setStartNo] = useState('');
  const [endNo, setEndNo] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      setData(await apiFetch(`/officers/${id}/collections?${params.toString()}`));
    } catch (err) { setError(err.message); }
  }, [id, from, to]);

  useEffect(() => { load(); }, [load]);

  async function addBook(e) {
    e.preventDefault();
    setError('');
    try {
      await apiFetch(`/officers/${id}/books`, {
        method: 'POST', body: JSON.stringify({ startNo: Number(startNo), endNo: Number(endNo) })
      });
      setStartNo(''); setEndNo('');
      load();
    } catch (err) { setError(err.message); }
  }

  async function removeBook(b) {
    if (!window.confirm(`Delete receipt book ${b.startNo}-${b.endNo}?`)) return;
    try {
      await apiFetch(`/officers/${id}/books/${b.bookId}`, { method: 'DELETE' });
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <Layout>
      <div className="container">
        <div className="toolbar">
          <h2>{data ? data.officerName : 'Officer'}</h2>
          <Link to="/officers"><button className="secondary"><ArrowLeft size={14} /> All officers</button></Link>
        </div>
        {error && <div className="error">{error}</div>}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Receipt books</h3>
          {data && data.books.length === 0 && <div className="empty-state">No receipt book issued yet.</div>}
          {data && data.books.length > 0 && (
            <table>
              <thead><tr><th>Range</th><th>Next number</th><th>Used</th><th>Remaining</th><th>Issued</th><th></th></tr></thead>
              <tbody>
                {data.books.map((b) => (
                  <tr key={b.bookId}>
                    <td>{b.startNo} – {b.endNo}</td>
                    <td>{b.remaining > 0 ? b.nextNo : <span className="badge badge-unpaid">Finished</span>}</td>
                    <td>{b.used}</td><td>{b.remaining}</td><td>{b.issuedAt}</td>
                    <td className="actions"><button className="danger" onClick={() => removeBook(b)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form onSubmit={addBook} className="inline-form">
            <input type="number" min="1" placeholder="From (e.g. 1000)" value={startNo} onChange={(e) => setStartNo(e.target.value)} />
            <input type="number" min="1" placeholder="To (e.g. 1100)" value={endNo} onChange={(e) => setEndNo(e.target.value)} />
            <button type="submit" disabled={!startNo || !endNo}><Plus size={16} /> Issue book</button>
          </form>
        </div>

        <div className="card">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Receipts collected{data ? ` — ${data.receiptCount} receipts, ${money(data.total)}` : ''}</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label className="date-filter">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="date-filter">to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          </div>
          {data && data.receipts.length === 0 ? <div className="empty-state">No receipts in this period.</div> : (
            <table>
              <thead><tr><th>Receipt</th><th>Date</th><th>Member</th><th>Amount</th></tr></thead>
              <tbody>
                {data && data.receipts.map((r) => (
                  <tr key={r.paymentId}>
                    <td><Link to={`/receipts/${r.paymentId}`}>#{r.receiptNo}</Link></td>
                    <td>{r.paidDate}</td>
                    <td><Link to={`/members/${encodeURIComponent(r.memberId)}`}>{r.memberName}</Link></td>
                    <td>{money(r.total)}</td>
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
