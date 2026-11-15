import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../api/client';
import { money } from '../api/format';
import Layout from '../components/Layout';

export default function Receipt() {
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch(`/payments/${id}`).then(setP).catch((e) => setError(e.message));
  }, [id]);

  return (
    <Layout>
      <div className="container">
        <div className="toolbar no-print">
          {p ? <Link to={`/members/${encodeURIComponent(p.memberId)}`}><button className="secondary"><ArrowLeft size={14} /> Back to member</button></Link> : <span />}
          <button onClick={() => window.print()}><Printer size={16} /> Print</button>
        </div>
        {error && <div className="error">{error}</div>}
        {p && (
          <div className="card receipt">
            <div className="receipt-head">
              <div>
                <div className="receipt-title">Payment Receipt</div>
                <div className="muted">Union Members Samithiya</div>
              </div>
              <div className="receipt-no">No. {p.receiptNo}</div>
            </div>
            <div className="detail-grid">
              <div><span className="muted">Received from</span><br />{p.memberName} (#{p.memberId})</div>
              <div><span className="muted">Date</span><br />{p.paidDate}</div>
              <div><span className="muted">Collected by</span><br />{p.officerName || '—'}</div>
            </div>
            <table>
              <thead><tr><th>Paid for</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {p.items.map((i, idx) => (
                  <tr key={idx}><td>{i.label}</td><td style={{ textAlign: 'right' }}>{money(i.amount)}</td></tr>
                ))}
                <tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{money(p.total)}</strong></td></tr>
              </tbody>
            </table>
            {p.notes && <p className="muted">{p.notes}</p>}
          </div>
        )}
      </div>
    </Layout>
  );
}
