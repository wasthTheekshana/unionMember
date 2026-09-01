import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import Header from '../components/Header';

const emptyForm = { memberId: '', memberName: '', officerId: '', phone: '', email: '', address: '' };

export default function MemberForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [officers, setOfficers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/officers').then(setOfficers).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    apiFetch(`/members/${id}`)
      .then((m) => setForm({
        memberId: String(m.memberId),
        memberName: m.memberName,
        officerId: m.officerId ? String(m.officerId) : '',
        phone: m.phone || '',
        email: m.email || '',
        address: m.address || ''
      }))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = {
      memberName: form.memberName,
      officerId: form.officerId ? Number(form.officerId) : null,
      phone: form.phone,
      email: form.email,
      address: form.address
    };
    try {
      if (isEdit) {
        await apiFetch(`/members/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/members', {
          method: 'POST',
          body: JSON.stringify({ ...payload, memberId: form.memberId.trim() })
        });
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <Header />
        <div className="container" style={{ maxWidth: 560 }}>
          <div className="card">Loading…</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="container" style={{ maxWidth: 560 }}>
        <div className="card">
          <h2>{isEdit ? 'Edit Member' : 'Add Member'}</h2>
          {error && <div className="error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div>
                <label htmlFor="memberId">Member ID</label>
                <input
                  id="memberId"
                  value={form.memberId}
                  disabled={isEdit}
                  onChange={(e) => update('memberId', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="memberName">Member Name</label>
                <input
                  id="memberName"
                  value={form.memberName}
                  onChange={(e) => update('memberName', e.target.value)}
                />
              </div>
            </div>

            <label htmlFor="officerId">Collecting Officer</label>
            <select id="officerId" value={form.officerId} onChange={(e) => update('officerId', e.target.value)}>
              <option value="">-- none --</option>
              {officers.map((o) => (
                <option key={o.officerId} value={o.officerId}>{o.officerName}</option>
              ))}
            </select>

            <div className="form-row">
              <div>
                <label htmlFor="phone">Phone</label>
                <input id="phone" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
              </div>
              <div>
                <label htmlFor="email">Email</label>
                <input id="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
              </div>
            </div>

            <label htmlFor="address">Address</label>
            <input id="address" value={form.address} onChange={(e) => update('address', e.target.value)} />

            <div className="form-actions">
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" className="secondary" onClick={() => navigate('/')}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
