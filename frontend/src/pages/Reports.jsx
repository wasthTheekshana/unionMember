import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Save, Undo2 } from 'lucide-react';
import { apiFetch } from '../api/client';
import { money, todayStr } from '../api/format';
import Layout from '../components/Layout';

export default function Reports() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Date().getFullYear());
  const [expenses, setExpenses] = useState([]);
  const [benefits, setBenefits] = useState([]);
  const [settings, setSettings] = useState({ monthlyFee: '', membershipFee: '' });
  const [exp, setExp] = useState({ expenseDate: todayStr(), category: '', description: '', amount: '' });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [fromYear, setFromYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    try {
      const [r, e, b, s] = await Promise.all([
        apiFetch('/reports/yearly'),
        apiFetch(`/expenses?year=${selected}`),
        apiFetch(`/death-benefits?year=${selected}`),
        apiFetch('/settings')
      ]);
      setRows(r); setExpenses(e); setBenefits(b); setSettings(s);
    } catch (err) { setError(err.message); }
  }, [selected]);

  useEffect(() => { load(); }, [load]);

  const cur = rows.find((r) => r.year === selected);

  async function addExpense(e) {
    e.preventDefault(); setError('');
    try {
      await apiFetch('/expenses', { method: 'POST', body: JSON.stringify({ ...exp, amount: Number(exp.amount) }) });
      setExp({ ...exp, category: '', description: '', amount: '' });
      load();
    } catch (err) { setError(err.message); }
  }

  async function delExpense(id) {
    if (!window.confirm('Delete this expense?')) return;
    try { await apiFetch(`/expenses/${id}`, { method: 'DELETE' }); load(); } catch (err) { setError(err.message); }
  }

  async function saveSettings(e) {
    e.preventDefault(); setError(''); setSaved(false);
    try {
      const s = await apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify({
          monthlyFee: Number(settings.monthlyFee),
          membershipFee: Number(settings.membershipFee),
          fromYear: Number(fromYear)
        })
      });
      setSettings(s); setSaved(true); load();
    } catch (err) { setError(err.message); }
  }

  async function reverseDeath(b) {
    const reason = window.prompt(
      `Reverse the death record of ${b.deceasedName} (${money(b.amount)})?\nThey are marked alive/active again and the payout is removed.\n\nWhy is it being reversed?`
    );
    if (reason === null) return;
    if (reason.trim().length < 3) { setError('A reason (at least 3 characters) is required.'); return; }
    try {
      await apiFetch(`/death-benefits/${b.benefitId}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) });
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <Layout>
      <div className="container">
        <div className="toolbar"><h2>Yearly Report</h2></div>
        {error && <div className="error">{error}</div>}

        <div className="card">
          {rows.length === 0 ? <div className="empty-state">No money recorded yet.</div> : (
            <table>
              <thead>
                <tr><th>Year</th><th>Membership fees</th><th>Monthly contributions</th><th>Equipment rental</th>
                  <th>Total income</th><th>Death benefits paid</th><th>Other expenses</th><th>Profit</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.year} className={r.year === selected ? 'row-selected' : ''} onClick={() => setSelected(r.year)} style={{ cursor: 'pointer' }}>
                    <td><strong>{r.year}</strong></td>
                    <td>{money(r.membershipFees)}</td><td>{money(r.monthlyContributions)}</td><td>{money(r.rentalIncome)}</td>
                    <td>{money(r.totalIncome)}</td><td>{money(r.deathBenefits)}</td><td>{money(r.otherExpenses)}</td>
                    <td><strong className={r.profit < 0 ? 'text-due' : 'text-profit'}>{money(r.profit)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>
            Profit = membership fees + monthly contributions + equipment rental − death benefits paid − other expenses.
            Click a year to see its details below.
          </p>
        </div>

        <div className="card">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Other expenses in {selected} {cur ? `— ${money(cur.otherExpenses)}` : ''}</h3>
          </div>
          {expenses.length > 0 && (
            <table>
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead>
              <tbody>
                {expenses.map((x) => (
                  <tr key={x.expenseId}>
                    <td>{x.expenseDate}</td><td>{x.category}</td><td>{x.description || '—'}</td><td>{money(x.amount)}</td>
                    <td className="actions"><button className="danger" onClick={() => delExpense(x.expenseId)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form onSubmit={addExpense} className="inline-form">
            <input type="date" value={exp.expenseDate} onChange={(e) => setExp({ ...exp, expenseDate: e.target.value })} />
            <input placeholder="Category (e.g. Chairs purchase)" value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })} />
            <input placeholder="Description" value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} />
            <input type="number" min="0" step="0.01" placeholder="Amount" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} />
            <button type="submit" disabled={!exp.category.trim() || exp.amount === ''}><Plus size={16} /> Add expense</button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Death benefits paid in {selected} {cur ? `— ${money(cur.deathBenefits)}` : ''}</h3>
          {benefits.length === 0 ? <div className="empty-state">None recorded.</div> : (
            <table>
              <thead><tr><th>Paid</th><th>Family of</th><th>Who passed away</th><th>Amount</th><th></th></tr></thead>
              <tbody>
                {benefits.map((b) => (
                  <tr key={b.benefitId}>
                    <td>{b.paidDate}</td><td>{b.memberName} (#{b.memberId})</td>
                    <td>{b.deceasedName} — {b.relationship.toLowerCase()}</td><td>{money(b.amount)}</td>
                    <td className="actions"><button className="secondary" title="Reverse a death recorded by mistake" onClick={() => reverseDeath(b)}><Undo2 size={14} /> Reverse</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form className="card" onSubmit={saveSettings}>
          <h3 style={{ marginTop: 0 }}>Fees</h3>
          <div className="form-row">
            <div><label>Monthly contribution (Rs)</label>
              <input type="number" min="1" value={settings.monthlyFee} onChange={(e) => setSettings({ ...settings, monthlyFee: e.target.value })} /></div>
            <div><label>Yearly membership fee (Rs)</label>
              <input type="number" min="0" value={settings.membershipFee} onChange={(e) => setSettings({ ...settings, membershipFee: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div><label>Applies from year</label>
              <input type="number" min="2000" max="2100" value={fromYear} onChange={(e) => setFromYear(e.target.value)} /></div>
            <div />
          </div>
          <p className="muted">
            The new fees apply from this year onward. Earlier years keep the fees they had, so their paid / unpaid
            status and receipts do not change.
            {settings.schedule && settings.schedule.length > 0 && (
              <> History: {settings.schedule.map((s) => `from ${s.fromYear === 2000 ? 'the start' : s.fromYear}: ${money(s.monthlyFee)} + ${money(s.membershipFee)}`).join(' · ')}.</>
            )}
          </p>
          <div className="form-actions">
            <button type="submit"><Save size={16} /> Save fees</button>
            {saved && <span className="muted">Saved.</span>}
          </div>
        </form>
      </div>
    </Layout>
  );
}
