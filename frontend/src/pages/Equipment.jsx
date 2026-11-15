import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Save, X, Undo2, HandHelping, Trash2 } from 'lucide-react';
import { apiFetch } from '../api/client';
import { money, todayStr } from '../api/format';
import Layout from '../components/Layout';

const EMPTY = { name: '', totalQty: '', memberPrice: '', visitorPrice: '' };

export default function Equipment() {
  const [items, setItems] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(EMPTY);
  const [rent, setRent] = useState({
    equipmentId: '', renterType: 'MEMBER', memberId: '', renterName: '', qty: 1, days: 1, rentDate: todayStr(), receiptNo: ''
  });
  const [showReturned, setShowReturned] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, r] = await Promise.all([
        apiFetch('/equipment'),
        apiFetch(`/rentals${showReturned ? '' : '?status=OUT'}`)
      ]);
      setItems(e); setRentals(r);
    } catch (err) { setError(err.message); }
  }, [showReturned]);

  useEffect(() => { load(); }, [load]);

  async function searchMembers(text) {
    setRent((r) => ({ ...r, memberId: text }));
    if (text.trim().length < 2) { setMembers([]); return; }
    try {
      const res = await apiFetch(`/members?pageSize=8&search=${encodeURIComponent(text.trim())}`);
      setMembers(res.items);
    } catch { setMembers([]); }
  }

  const body = (f) => JSON.stringify({
    name: f.name, totalQty: Number(f.totalQty), memberPrice: Number(f.memberPrice), visitorPrice: Number(f.visitorPrice)
  });

  async function add(e) {
    e.preventDefault(); setError('');
    try {
      await apiFetch('/equipment', { method: 'POST', body: body(form) });
      setForm(EMPTY); load();
    } catch (err) { setError(err.message); }
  }

  async function save(id) {
    setError('');
    try {
      await apiFetch(`/equipment/${id}`, { method: 'PUT', body: body(edit) });
      setEditId(null); load();
    } catch (err) { setError(err.message); }
  }

  async function issue(e) {
    e.preventDefault(); setError('');
    try {
      await apiFetch('/rentals', {
        method: 'POST',
        body: JSON.stringify({
          ...rent, equipmentId: Number(rent.equipmentId), qty: Number(rent.qty), days: Number(rent.days)
        })
      });
      setRent({ ...rent, memberId: '', renterName: '', qty: 1, days: 1, receiptNo: '' });
      setMembers([]);
      load();
    } catch (err) { setError(err.message); }
  }

  async function giveBack(r) {
    try {
      await apiFetch(`/rentals/${r.rentalId}/return`, { method: 'PUT', body: JSON.stringify({ returnedDate: todayStr() }) });
      load();
    } catch (err) { setError(err.message); }
  }

  async function voidRental(r) {
    const reason = window.prompt(`Void this rental of ${r.qty} × ${r.equipmentName} for ${r.renterName}?\nThe stock is returned.\n\nWhy is it being voided?`);
    if (reason === null) return;
    if (reason.trim().length < 3) { setError('A reason (at least 3 characters) is required to void a rental.'); return; }
    try {
      await apiFetch(`/rentals/${r.rentalId}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) });
      load();
    } catch (err) { setError(err.message); }
  }

  const chosen = items.find((i) => String(i.equipmentId) === String(rent.equipmentId));
  const unit = chosen ? (rent.renterType === 'MEMBER' ? chosen.memberPrice : chosen.visitorPrice) : 0;

  return (
    <Layout>
      <div className="container">
        <div className="toolbar"><h2>Equipment (chairs, tables, …)</h2></div>
        {error && <div className="error">{error}</div>}

        <div className="card">
          <table>
            <thead><tr><th>Item</th><th>Total</th><th>Rented out</th><th>In stock now</th><th>Member price / day</th><th>Visitor price / day</th><th></th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.equipmentId}>
                  {editId === i.equipmentId ? (
                    <>
                      <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                      <td><input type="number" min="0" style={{ width: 80 }} value={edit.totalQty} onChange={(e) => setEdit({ ...edit, totalQty: e.target.value })} /></td>
                      <td>{i.rentedOut}</td><td>—</td>
                      <td><input type="number" min="0" style={{ width: 100 }} value={edit.memberPrice} onChange={(e) => setEdit({ ...edit, memberPrice: e.target.value })} /></td>
                      <td><input type="number" min="0" style={{ width: 100 }} value={edit.visitorPrice} onChange={(e) => setEdit({ ...edit, visitorPrice: e.target.value })} /></td>
                      <td className="actions">
                        <button onClick={() => save(i.equipmentId)}><Save size={14} /> Save</button>
                        <button className="secondary" onClick={() => setEditId(null)}><X size={14} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{i.name}</td><td>{i.totalQty}</td><td>{i.rentedOut}</td>
                      <td><span className={`badge ${i.available === 0 ? 'badge-unpaid' : i.available <= i.totalQty * 0.2 ? 'badge-partial' : 'badge-paid'}`}>{i.available}</span></td>
                      <td>{money(i.memberPrice)}</td><td>{money(i.visitorPrice)}</td>
                      <td className="actions">
                        <button className="secondary" onClick={() => { setEditId(i.equipmentId); setEdit({ name: i.name, totalQty: i.totalQty, memberPrice: i.memberPrice, visitorPrice: i.visitorPrice }); }}>
                          <Pencil size={14} /> Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={7} className="empty-state">No equipment added yet.</td></tr>}
            </tbody>
          </table>
          <form onSubmit={add} className="inline-form">
            <input placeholder="Item name (e.g. Chair)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input type="number" min="0" placeholder="Quantity" value={form.totalQty} onChange={(e) => setForm({ ...form, totalQty: e.target.value })} />
            <input type="number" min="0" placeholder="Member price/day" value={form.memberPrice} onChange={(e) => setForm({ ...form, memberPrice: e.target.value })} />
            <input type="number" min="0" placeholder="Visitor price/day" value={form.visitorPrice} onChange={(e) => setForm({ ...form, visitorPrice: e.target.value })} />
            <button type="submit" disabled={!form.name.trim() || form.totalQty === '' || form.memberPrice === '' || form.visitorPrice === ''}>
              <Plus size={16} /> Add item
            </button>
          </form>
        </div>

        <form className="card" onSubmit={issue}>
          <h3 style={{ marginTop: 0 }}>Rent out</h3>
          <div className="form-row">
            <div>
              <label>Item</label>
              <select required value={rent.equipmentId} onChange={(e) => setRent({ ...rent, equipmentId: e.target.value })}>
                <option value="">— choose —</option>
                {items.map((i) => <option key={i.equipmentId} value={i.equipmentId}>{i.name} ({i.available} in stock)</option>)}
              </select>
            </div>
            <div>
              <label>Rented by</label>
              <select value={rent.renterType} onChange={(e) => setRent({ ...rent, renterType: e.target.value, memberId: '', renterName: '' })}>
                <option value="MEMBER">Member</option><option value="VISITOR">Visitor (outsider)</option>
              </select>
            </div>
            {rent.renterType === 'MEMBER' ? (
              <div>
                <label>Member (type name or ID)</label>
                <input value={rent.memberId} placeholder="Search…" onChange={(e) => searchMembers(e.target.value)} />
                {members.length > 0 && (
                  <div className="suggest">
                    {members.map((m) => (
                      <div key={m.memberId} onClick={() => { setRent({ ...rent, memberId: m.memberId }); setMembers([]); }}>
                        #{m.memberId} — {m.memberName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div><label>Visitor name</label><input value={rent.renterName} onChange={(e) => setRent({ ...rent, renterName: e.target.value })} /></div>
            )}
          </div>
          <div className="form-row">
            <div><label>Quantity</label><input type="number" min="1" value={rent.qty} onChange={(e) => setRent({ ...rent, qty: e.target.value })} /></div>
            <div><label>Days</label><input type="number" min="1" value={rent.days} onChange={(e) => setRent({ ...rent, days: e.target.value })} /></div>
            <div><label>Date given</label><input type="date" value={rent.rentDate} onChange={(e) => setRent({ ...rent, rentDate: e.target.value })} /></div>
            <div><label>Receipt no. (optional)</label><input value={rent.receiptNo} onChange={(e) => setRent({ ...rent, receiptNo: e.target.value })} /></div>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={!rent.equipmentId}>
              <HandHelping size={16} /> Give out — {money(unit * (Number(rent.qty) || 0) * (Number(rent.days) || 0))}
            </button>
          </div>
        </form>

        <div className="card">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{showReturned ? 'All rentals' : 'Currently rented out'}</h3>
            <label className="check"><input type="checkbox" checked={showReturned} onChange={(e) => setShowReturned(e.target.checked)} /> Show returned</label>
          </div>
          {rentals.length === 0 ? <div className="empty-state">Nothing here.</div> : (
            <table>
              <thead><tr><th>Item</th><th>Qty</th><th>Rented by</th><th>Given</th><th>Days</th><th>Charge</th><th>Receipt</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rentals.map((r) => (
                  <tr key={r.rentalId}>
                    <td>{r.equipmentName}</td><td>{r.qty}</td>
                    <td>{r.renterName} <span className="muted">({r.renterType === 'MEMBER' ? `member #${r.memberId}` : 'visitor'})</span></td>
                    <td>{r.rentDate}</td><td>{r.days}</td><td>{money(r.amount)}</td><td>{r.receiptNo || '—'}</td>
                    <td>{r.status === 'OUT' ? <span className="badge badge-partial">Out</span> : <span className="badge badge-paid">Returned {r.returnedDate}</span>}</td>
                    <td className="actions">
                      {r.status === 'OUT' && <button className="secondary" onClick={() => giveBack(r)}><Undo2 size={14} /> Returned</button>}
                      <button className="danger icon-only" title="Void this rental" aria-label="Void this rental" onClick={() => voidRental(r)}><Trash2 size={14} /></button>
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
