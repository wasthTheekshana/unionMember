import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2, Receipt, HeartCrack } from 'lucide-react';
import { apiFetch } from '../api/client';
import { MONTHS, money, todayStr, STATUS_LABEL } from '../api/format';
import Layout from '../components/Layout';

const REL_LABEL = { SPOUSE: 'Spouse', CHILD: 'Child', PARENT: 'Parent', OTHER: 'Other', SELF: 'Member' };

export default function MemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [member, setMember] = useState(null);
  const [officers, setOfficers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [family, setFamily] = useState([]);
  const [benefits, setBenefits] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // payment form
  const [selMonths, setSelMonths] = useState([]);
  const [selMembership, setSelMembership] = useState(false);
  const [payOfficer, setPayOfficer] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [paidDate, setPaidDate] = useState(todayStr());
  const [nextReceipt, setNextReceipt] = useState(null);
  const [paying, setPaying] = useState(false);

  // family form
  const [famName, setFamName] = useState('');
  const [famRel, setFamRel] = useState('SPOUSE');
  const [famDependent, setFamDependent] = useState(true);
  const [deathFor, setDeathFor] = useState(null); // familyId | 'SELF' | null
  const [death, setDeath] = useState({ deathDate: todayStr(), amount: '', notes: '' });

  const load = useCallback(async () => {
    setError('');
    try {
      const [m, p, f, b, o] = await Promise.all([
        apiFetch(`/members/${encodeURIComponent(id)}?year=${year}`),
        apiFetch(`/payments?memberId=${encodeURIComponent(id)}&limit=200`),
        apiFetch(`/members/${encodeURIComponent(id)}/family`),
        apiFetch(`/death-benefits?memberId=${encodeURIComponent(id)}`),
        apiFetch('/officers')
      ]);
      setMember(m); setPayments(p); setFamily(f); setBenefits(b); setOfficers(o);
      setPayOfficer((cur) => cur || (m.officerId ? String(m.officerId) : ''));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, year]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelMonths([]); setSelMembership(false); }, [year]);

  useEffect(() => {
    if (!payOfficer) { setNextReceipt(null); return; }
    apiFetch(`/payments/next-receipt?officerId=${payOfficer}`)
      .then((r) => setNextReceipt(r.nextReceiptNo)).catch(() => setNextReceipt(null));
  }, [payOfficer, payments.length]);

  if (loading) return <Layout><div className="container"><div className="loading-state">Loading…</div></div></Layout>;
  if (!member) return <Layout><div className="container"><div className="error">{error || 'Not found'}</div></div></Layout>;

  const ys = member.yearStatus;
  const selectedTotal = (selMembership ? ys.membershipFee : 0) + selMonths.length * ys.monthlyFee;

  function toggleMonth(m) {
    setSelMonths((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  function selectAllUnpaid() {
    setSelMonths(ys.months.filter((x) => !x.paid).map((x) => x.month));
    if (!ys.membership.paid) setSelMembership(true);
  }

  async function handlePay(e) {
    e.preventDefault();
    setError(''); setPaying(true);
    try {
      const p = await apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          memberId: member.memberId, year, months: selMonths, membership: selMembership,
          officerId: payOfficer ? Number(payOfficer) : undefined,
          receiptNo: receiptNo || undefined, paidDate
        })
      });
      navigate(`/receipts/${p.paymentId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  }

  async function addFamily(e) {
    e.preventDefault();
    setError('');
    try {
      await apiFetch(`/members/${encodeURIComponent(id)}/family`, {
        method: 'POST',
        body: JSON.stringify({ name: famName, relationship: famRel, isDependent: famDependent })
      });
      setFamName('');
      load();
    } catch (err) { setError(err.message); }
  }

  async function removeFamily(f) {
    if (!window.confirm(`Remove ${f.name} from the family list?`)) return;
    try {
      await apiFetch(`/members/${encodeURIComponent(id)}/family/${f.familyId}`, { method: 'DELETE' });
      load();
    } catch (err) { setError(err.message); }
  }

  async function submitDeath(e) {
    e.preventDefault();
    setError('');
    const path = deathFor === 'SELF'
      ? `/members/${encodeURIComponent(id)}/death`
      : `/members/${encodeURIComponent(id)}/family/${deathFor}/death`;
    try {
      await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ deathDate: death.deathDate, amount: death.amount === '' ? 0 : Number(death.amount), notes: death.notes })
      });
      setDeathFor(null);
      setDeath({ deathDate: todayStr(), amount: '', notes: '' });
      load();
    } catch (err) { setError(err.message); }
  }

  async function voidPayment(p) {
    const reason = window.prompt(
      `Void receipt ${p.receiptNo}? Those months become unpaid again and the receipt number is not reused.\n\nWhy is it being voided?`
    );
    if (reason === null) return;
    if (reason.trim().length < 3) { setError('A reason (at least 3 characters) is required to void a receipt.'); return; }
    try {
      await apiFetch(`/payments/${p.paymentId}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) });
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <Layout>
      <div className="container">
        <div className="toolbar">
          <h2>
            {member.memberName} <span className="muted">#{member.memberId}</span>{' '}
            {!member.isActive && <span className="badge badge-unpaid">Inactive (deceased)</span>}
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to={`/members/${encodeURIComponent(member.memberId)}/edit`}>
              <button className="secondary"><Pencil size={14} /> Edit</button>
            </Link>
            {member.isActive && (
              <button className="danger" onClick={() => setDeathFor(deathFor === 'SELF' ? null : 'SELF')}>
                <HeartCrack size={14} /> Member passed away
              </button>
            )}
          </div>
        </div>
        {error && <div className="error">{error}</div>}

        <div className="card">
          <div className="detail-grid">
            <div><span className="muted">Collecting officer</span><br />{member.officerName || '—'}</div>
            <div><span className="muted">Phone</span><br />{member.phone || '—'}</div>
            <div><span className="muted">Email</span><br />{member.email || '—'}</div>
            <div><span className="muted">Address</span><br />{member.address || '—'}</div>
          </div>
        </div>

        {deathFor && (
          <DeathForm
            title={deathFor === 'SELF' ? `Record death of member ${member.memberName}` : 'Record death of family member'}
            death={death} setDeath={setDeath} onSubmit={submitDeath} onCancel={() => setDeathFor(null)}
          />
        )}

        <div className="card">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>
              Payments {year}{' '}
              <span className={`badge badge-${ys.status.toLowerCase()}`}>{STATUS_LABEL[ys.status]}</span>
            </h3>
            <label className="date-filter">
              Year
              <input type="number" min="2000" max="2100" value={year} style={{ width: 90 }}
                onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())} />
            </label>
          </div>
          <div className="summary-row">
            <div><span className="muted">Yearly total</span><br /><strong>{money(ys.yearlyTotal)}</strong></div>
            <div><span className="muted">Paid</span><br /><strong>{money(ys.paidAmount)}</strong></div>
            <div><span className="muted">Still to pay</span><br /><strong className={ys.dueAmount ? 'text-due' : ''}>{money(ys.dueAmount)}</strong></div>
            <div className="muted">Membership {money(ys.membershipFee)} + 12 × {money(ys.monthlyFee)}</div>
          </div>

          <form onSubmit={handlePay}>
            <div className="chip-grid">
              <button type="button"
                className={`chip ${ys.membership.paid ? 'chip-paid' : selMembership ? 'chip-selected' : ''}`}
                disabled={ys.membership.paid} onClick={() => setSelMembership((v) => !v)}>
                Membership<br /><small>{ys.membership.paid ? `#${ys.membership.receiptNo}` : money(ys.membershipFee)}</small>
              </button>
              {ys.months.map((m) => (
                <button type="button" key={m.month}
                  className={`chip ${m.paid ? 'chip-paid' : selMonths.includes(m.month) ? 'chip-selected' : ''}`}
                  disabled={m.paid} onClick={() => toggleMonth(m.month)}>
                  {MONTHS[m.month - 1]}<br /><small>{m.paid ? `#${m.receiptNo}` : money(m.amount)}</small>
                </button>
              ))}
            </div>
            {ys.status !== 'PAID' && member.isActive && (
              <>
                <div style={{ margin: '8px 0 14px' }}>
                  <button type="button" className="secondary" onClick={selectAllUnpaid}>Select everything unpaid</button>
                </div>
                <div className="form-row">
                  <div>
                    <label>Collecting officer</label>
                    <select value={payOfficer} onChange={(e) => setPayOfficer(e.target.value)}>
                      <option value="">— choose —</option>
                      {officers.map((o) => <option key={o.officerId} value={o.officerId}>{o.officerName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Receipt no. {nextReceipt ? `(auto: ${nextReceipt})` : payOfficer ? '(no book left)' : ''}</label>
                    <input type="number" placeholder={nextReceipt ? `${nextReceipt}` : ''} value={receiptNo}
                      onChange={(e) => setReceiptNo(e.target.value)} />
                  </div>
                  <div>
                    <label>Date paid</label>
                    <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                  </div>
                </div>
                <div className="form-actions">
                  <button type="submit" disabled={paying || selectedTotal === 0 || !payOfficer}>
                    <Receipt size={16} /> {paying ? 'Saving…' : `Receive ${money(selectedTotal)} & issue receipt`}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Receipts</h3>
          {payments.length === 0 ? <div className="empty-state">No payments yet.</div> : (
            <table>
              <thead><tr><th>Receipt</th><th>Date</th><th>Paid for</th><th>Officer</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.paymentId}>
                    <td><Link to={`/receipts/${p.paymentId}`}>#{p.receiptNo}</Link></td>
                    <td>{p.paidDate}</td>
                    <td>{p.items.map((i) => i.label).join(', ')}</td>
                    <td>{p.officerName || '—'}</td>
                    <td>{money(p.total)}</td>
                    <td className="actions"><button className="danger" onClick={() => voidPayment(p)}><Trash2 size={14} /> Void</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Family</h3>
          {family.length > 0 && (
            <table>
              <thead><tr><th>Name</th><th>Relationship</th><th>Dependent</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {family.map((f) => (
                  <tr key={f.familyId}>
                    <td>{f.name}</td>
                    <td>{REL_LABEL[f.relationship]}</td>
                    <td>{f.isDependent ? 'Yes' : 'No'}</td>
                    <td>{f.status === 'DECEASED' ? <span className="badge badge-unpaid">Deceased {f.deceasedDate}</span> : <span className="badge badge-paid">Alive</span>}</td>
                    <td className="actions">
                      {f.status === 'ALIVE' && (
                        <button className="secondary" onClick={() => setDeathFor(f.familyId)}><HeartCrack size={14} /> Passed away</button>
                      )}
                      <button className="danger" onClick={() => removeFamily(f)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form onSubmit={addFamily} className="inline-form">
            <input placeholder="Family member name" value={famName} onChange={(e) => setFamName(e.target.value)} />
            <select value={famRel} onChange={(e) => setFamRel(e.target.value)}>
              <option value="SPOUSE">Spouse</option><option value="CHILD">Child</option>
              <option value="PARENT">Parent</option><option value="OTHER">Other</option>
            </select>
            <label className="check"><input type="checkbox" checked={famDependent} onChange={(e) => setFamDependent(e.target.checked)} /> Dependent</label>
            <button type="submit" disabled={!famName.trim()}><Plus size={16} /> Add</button>
          </form>
        </div>

        {benefits.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Death benefits given to this family</h3>
            <table>
              <thead><tr><th>Date paid</th><th>Who passed away</th><th>Date of death</th><th>Amount</th><th>Notes</th></tr></thead>
              <tbody>
                {benefits.map((b) => (
                  <tr key={b.benefitId}>
                    <td>{b.paidDate}</td>
                    <td>{b.deceasedName} ({REL_LABEL[b.relationship]})</td>
                    <td>{b.deathDate}</td>
                    <td>{money(b.amount)}</td>
                    <td>{b.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

function DeathForm({ title, death, setDeath, onSubmit, onCancel }) {
  return (
    <form className="card" onSubmit={onSubmit}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="form-row">
        <div><label>Date of death</label>
          <input type="date" required value={death.deathDate} onChange={(e) => setDeath({ ...death, deathDate: e.target.value })} /></div>
        <div><label>Amount given by samithiya (Rs)</label>
          <input type="number" min="0" step="0.01" required value={death.amount} onChange={(e) => setDeath({ ...death, amount: e.target.value })} /></div>
        <div><label>Notes</label>
          <input value={death.notes} onChange={(e) => setDeath({ ...death, notes: e.target.value })} /></div>
      </div>
      <div className="form-actions">
        <button type="submit" className="danger">Confirm</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
