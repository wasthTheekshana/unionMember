import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Users, HandHelping, HeartHandshake, PiggyBank,
  Lightbulb, AlertTriangle, CheckCircle2, Info, ArrowUpRight
} from 'lucide-react';
import { apiFetch } from '../api/client';
import { money, MONTHS } from '../api/format';
import Layout from '../components/Layout';

const LOW_RECEIPTS = 20;
const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

function Delta({ now, before }) {
  if (!before) return <span className="pill pill-flat">no prior year data</span>;
  const p = Math.round(((now - before) / before) * 1000) / 10;
  const up = p >= 0;
  return (
    <span className={`pill ${up ? 'pill-up' : 'pill-down'}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {up ? '+' : ''}{p}% vs last year
    </span>
  );
}

function Ring({ value, size = 132, stroke = 12 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(Math.max(value, 0), 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value}% collected`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="26" fontWeight="700">{value}%</text>
    </svg>
  );
}

// Bars = money received per month, dashed line = monthly target.
function CashChart({ data, target }) {
  const W = 720, H = 230, L = 46, B = 28, T = 14, R = 8;
  const max = Math.max(...data.map((m) => m.total), target, 1) * 1.1;
  const bw = (W - L - R) / 12;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => Math.round((max * f) / 100) * 100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Money received each month against the monthly target">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid-line" />
          <text x={L - 6} y={y(t)} textAnchor="end" dominantBaseline="central" className="axis">{t >= 1000 ? `${t / 1000}k` : t}</text>
        </g>
      ))}
      {data.map((m, i) => (
        <g key={m.month}>
          <rect x={L + i * bw + bw * 0.18} width={bw * 0.64} y={y(m.total)} height={Math.max(H - B - y(m.total), 0)} rx="4" className="bar-rect">
            <title>{`${MONTHS[i]}: ${money(m.total)}`}</title>
          </rect>
          <text x={L + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="axis">{MONTHS[i]}</text>
        </g>
      ))}
      {target > 0 && (
        <g>
          <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} className="target-line" />
          <text x={W - R} y={y(target) - 6} textAnchor="end" className="axis axis-strong">Target {money(target)}</text>
        </g>
      )}
    </svg>
  );
}

function Donut({ parts, size = 150, stroke = 22 }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
      {total > 0 && parts.map((p) => {
        const len = (p.value / total) * c;
        const el = (
          <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        );
        acc += len;
        return el;
      })}
      <text x="50%" y="46%" textAnchor="middle" className="donut-num">{total}</text>
      <text x="50%" y="62%" textAnchor="middle" className="axis">members</text>
    </svg>
  );
}

function buildInsights(d) {
  const a = d.analytics;
  const out = [];
  const { current: cur, previous: prev } = a;

  if (prev.income > 0) {
    const p = Math.round(((cur.income - prev.income) / prev.income) * 100);
    out.push({
      tone: p >= 0 ? 'good' : 'bad', title: 'Year on year',
      text: `Income is ${money(cur.income)} so far, ${p >= 0 ? 'up' : 'down'} ${Math.abs(p)}% on ${d.year - 1} (${money(prev.income)}).`
    });
  } else {
    out.push({ tone: 'info', title: 'Year on year', text: `No income was recorded in ${d.year - 1}, so there is nothing to compare against yet.` });
  }

  if (a.monthsElapsed > 0 && cur.income > 0) {
    const share = pctOf(a.projectedIncome, d.expected);
    out.push({
      tone: share >= 90 ? 'good' : share >= 60 ? 'warn' : 'bad', title: 'Pace for the year',
      text: `At the current pace the samithiya will collect about ${money(a.projectedIncome)} by December, ${share}% of the ${money(d.expected)} expected.`
    });
  } else if (a.monthsElapsed > 0) {
    out.push({ tone: 'bad', title: 'Pace for the year', text: `${a.monthsElapsed} month${a.monthsElapsed > 1 ? 's' : ''} into ${d.year} and nothing has been collected yet.` });
  }

  const best = [...a.cashByMonth].sort((x, y) => y.total - x.total)[0];
  if (best && best.total > 0) {
    out.push({ tone: 'info', title: 'Best month', text: `${MONTHS[best.month - 1]} brought in the most: ${money(best.total)}.` });
  }

  const withMembers = d.officers.filter((o) => o.members >= 5);
  const ranked = withMembers.map((o) => ({ ...o, rate: pctOf(o.collected, o.members * d.yearlyFee) })).sort((x, y) => y.rate - x.rate);
  if (ranked.length > 1 && ranked[0].rate > 0) {
    const top = ranked[0], low = ranked[ranked.length - 1];
    out.push({
      tone: 'info', title: 'Officer performance',
      text: `${top.officerName} leads with ${top.rate}% of their members' dues collected; ${low.officerName} is lowest at ${low.rate}%.`
    });
  }

  if (cur.income > 0 && cur.deathBenefits > 0) {
    out.push({
      tone: pctOf(cur.deathBenefits, cur.income) > 50 ? 'warn' : 'info', title: 'Death benefits',
      text: `${money(cur.deathBenefits)} paid to families this year is ${pctOf(cur.deathBenefits, cur.income)}% of income.`
    });
  }

  if (cur.income > 0) {
    out.push({
      tone: cur.profit >= 0 ? 'good' : 'bad', title: 'Surplus',
      text: `After expenses of ${money(cur.expenses)}, the ${cur.profit >= 0 ? 'surplus' : 'shortfall'} is ${money(Math.abs(cur.profit))}.`
    });
  }

  const noBook = d.officers.filter((o) => o.members > 0 && o.receiptsLeft === 0).length;
  if (noBook > 0) {
    out.push({ tone: 'warn', title: 'Receipt books', text: `${noBook} officer${noBook > 1 ? 's have' : ' has'} no receipts left. Issue a book before they can collect.` });
  }
  return out;
}

const TONE_ICON = { good: CheckCircle2, bad: AlertTriangle, warn: AlertTriangle, info: Info };

export default function Dashboard() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    apiFetch(`/reports/dashboard?year=${year}`).then(setD).catch((err) => setError(err.message));
  }, [year]);

  const alerts = [];
  if (d) {
    const active = d.officers.filter((o) => o.members > 0);
    const none = active.filter((o) => o.receiptsLeft === 0);
    const low = active.filter((o) => o.receiptsLeft > 0 && o.receiptsLeft <= LOW_RECEIPTS);
    if (none.length > 0) alerts.push({ key: 'o-none', level: 'danger', to: '/officers', text: `${none.length} officer${none.length > 1 ? 's have' : ' has'} no receipts left` });
    if (low.length > 0) alerts.push({ key: 'o-low', level: 'warn', to: '/officers', text: `Receipts running low: ${low.map((o) => `${o.officerName} (${o.receiptsLeft})`).join(', ')}` });
    for (const s of d.stock) {
      if (s.totalQty > 0 && s.available === 0) alerts.push({ key: `s${s.equipmentId}`, level: 'danger', text: `${s.name}: none in stock`, to: '/equipment' });
      else if (s.totalQty > 0 && s.available <= s.totalQty * 0.2) alerts.push({ key: `s${s.equipmentId}`, level: 'warn', text: `${s.name}: only ${s.available} of ${s.totalQty} in stock`, to: '/equipment' });
    }
  }

  const a = d?.analytics;
  const insights = d ? buildInsights(d) : [];
  const sc = d?.statusCount;
  const mix = a ? [
    { label: 'Monthly contributions', value: a.current.monthlyContributions, color: 'var(--c1)' },
    { label: 'Membership fees', value: a.current.membershipFees, color: 'var(--c2)' },
    { label: 'Equipment rental', value: a.current.rentalIncome, color: 'var(--c3)' }
  ] : [];
  const mixTotal = mix.reduce((s, m) => s + m.value, 0);

  return (
    <Layout>
      <div className="container dash">
        <div className="toolbar">
          <div>
            <h2 style={{ marginBottom: 2 }}>Dashboard</h2>
            <div className="muted">Money, members and stock at a glance</div>
          </div>
          <label className="date-filter">
            Year
            <input type="number" min="2000" max="2100" value={year} style={{ width: 84 }}
              onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())} />
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        {!d && !error && <div className="loading-state">Loading dashboard…</div>}

        {d && (
          <>
            <section className="hero">
              <div className="hero-main">
                <div className="hero-label">Dues collected for {d.year}</div>
                <div className="hero-value">{money(d.collected)}</div>
                <div className="hero-sub">of {money(d.expected)} expected from {d.activeMembers} active members</div>
                <div className="hero-chips">
                  <Delta now={a.current.income} before={a.previous.income} />
                  <span className="pill pill-glass">{money(d.outstanding)} still to collect</span>
                  {a.monthsElapsed > 0 && a.current.income > 0 && (
                    <span className="pill pill-glass">Projected {money(a.projectedIncome)}</span>
                  )}
                </div>
              </div>
              <Ring value={d.collectionRate} />
            </section>

            <div className="kpis">
              <div className="kpi"><PiggyBank size={18} /><div><div className="kpi-v">{money(a.current.income)}</div><div className="kpi-l">Total income</div></div></div>
              <div className="kpi"><TrendingDown size={18} /><div><div className="kpi-v">{money(a.current.expenses)}</div><div className="kpi-l">Expenses</div></div></div>
              <div className={`kpi ${a.current.profit < 0 ? 'kpi-bad' : 'kpi-good'}`}><TrendingUp size={18} /><div><div className="kpi-v">{money(a.current.profit)}</div><div className="kpi-l">Surplus</div></div></div>
              <div className="kpi"><HeartHandshake size={18} /><div><div className="kpi-v">{money(d.deathBenefits.total)}</div><div className="kpi-l">Death benefits · {d.deathBenefits.count}</div></div></div>
              <div className="kpi"><HandHelping size={18} /><div><div className="kpi-v">{d.rentalsOut}</div><div className="kpi-l">Rentals out now</div></div></div>
              <div className="kpi"><Users size={18} /><div><div className="kpi-v">{d.activeMembers}</div><div className="kpi-l">Active · {d.totalMembers - d.activeMembers} inactive</div></div></div>
            </div>

            <div className="grid-main">
              <div className="card">
                <div className="card-head"><h3><Lightbulb size={16} /> Insights</h3><span className="muted">Worked out from your data</span></div>
                <ul className="insights">
                  {insights.map((i) => {
                    const Icon = TONE_ICON[i.tone];
                    return (
                      <li key={i.title} className={`insight insight-${i.tone}`}>
                        <Icon size={18} />
                        <div><strong>{i.title}</strong><div>{i.text}</div></div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="card">
                <div className="card-head"><h3>Needs attention</h3></div>
                {alerts.length === 0 ? <div className="empty-state">All clear. Receipts and stock look fine.</div> : (
                  <ul className="alert-list">
                    {alerts.map((al) => (
                      <li key={al.key} className={`alert alert-${al.level}`}>
                        <Link to={al.to}>{al.text} <ArrowUpRight size={14} /></Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Money received by month</h3><span className="muted">Contributions, fees and rentals · dashed line is the monthly target</span></div>
              <CashChart data={a.cashByMonth} target={a.monthlyTarget} />
            </div>

            <div className="grid-3">
              <div className="card">
                <div className="card-head"><h3>Payment status</h3></div>
                <div className="donut-wrap">
                  <Donut parts={[
                    { label: 'Fully paid', value: sc.PAID, color: 'var(--good)' },
                    { label: 'Partly paid', value: sc.PARTIAL, color: 'var(--warn)' },
                    { label: 'Not paid', value: sc.UNPAID, color: 'var(--bad)' }
                  ]} />
                  <ul className="legend">
                    <li><i style={{ background: 'var(--good)' }} />Fully paid <b>{sc.PAID}</b></li>
                    <li><i style={{ background: 'var(--warn)' }} />Partly paid <b>{sc.PARTIAL}</b></li>
                    <li><i style={{ background: 'var(--bad)' }} />Not paid <b>{sc.UNPAID}</b></li>
                  </ul>
                </div>
                <Link to="/members" className="more">See member list →</Link>
              </div>

              <div className="card">
                <div className="card-head"><h3>Where income comes from</h3></div>
                <div className="stack" role="img" aria-label="Income mix">
                  {mix.map((m) => <span key={m.label} style={{ width: `${pctOf(m.value, mixTotal)}%`, background: m.color }} />)}
                </div>
                <ul className="legend legend-rows">
                  {mix.map((m) => (
                    <li key={m.label}><i style={{ background: m.color }} />{m.label}<b>{money(m.value)}</b><span className="muted">{pctOf(m.value, mixTotal)}%</span></li>
                  ))}
                </ul>
              </div>

              <div className="card">
                <div className="card-head"><h3>Income vs last year</h3></div>
                <ul className="legend legend-rows">
                  <li>{d.year}<b>{money(a.current.income)}</b></li>
                  <li>{d.year - 1}<b>{money(a.previous.income)}</b></li>
                  <li>Expenses {d.year}<b>{money(a.current.expenses)}</b></li>
                  <li>Surplus {d.year}<b className={a.current.profit < 0 ? 'text-due' : 'text-profit'}>{money(a.current.profit)}</b></li>
                </ul>
                <Link to="/reports" className="more">Full yearly report →</Link>
              </div>
            </div>

            <div className="grid-main">
              <div className="card">
                <div className="card-head"><h3>Officer collection rate</h3><span className="muted">Collected ÷ dues of their members</span></div>
                <ul className="meters">
                  {d.officers.map((o) => {
                    const rate = pctOf(o.collected, o.members * d.yearlyFee);
                    return (
                      <li key={o.officerId}>
                        <div className="meter-top">
                          <Link to={`/officers/${o.officerId}`}>{o.officerName}</Link>
                          <span className="muted">{o.members} members · {money(o.collected)}</span>
                        </div>
                        <div className="meter"><span style={{ width: `${Math.min(rate, 100)}%` }} /></div>
                        <div className="meter-bottom">
                          <b>{rate}%</b>
                          <span className={`badge ${o.receiptsLeft === 0 ? 'badge-unpaid' : o.receiptsLeft <= LOW_RECEIPTS ? 'badge-partial' : 'badge-paid'}`}>{o.receiptsLeft} receipts left</span>
                        </div>
                      </li>
                    );
                  })}
                  {d.officers.length === 0 && <li className="empty-state">No officers.</li>}
                </ul>
              </div>

              <div className="stack-col">
                <div className="card">
                  <div className="card-head"><h3>Behind on monthly payments</h3><span className="muted">As of {MONTHS[Math.max(a.monthsElapsed, 1) - 1]}</span></div>
                  {a.behindMembers.length === 0 ? <div className="empty-state">Nobody is behind.</div> : (
                    <table>
                      <thead><tr><th>Member</th><th>Officer</th><th>Months behind</th><th>Owes</th></tr></thead>
                      <tbody>
                        {a.behindMembers.map((m) => (
                          <tr key={m.memberId}>
                            <td><Link to={`/members/${m.memberId}`}>{m.memberName}</Link></td>
                            <td>{m.officerName || '—'}</td>
                            <td><span className="badge badge-unpaid">{m.monthsBehind}</span></td>
                            <td>{money(m.owes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="card">
                  <div className="card-head"><h3>Equipment in stock</h3></div>
                  <table>
                    <thead><tr><th>Item</th><th>In stock</th><th>Total</th></tr></thead>
                    <tbody>
                      {d.stock.map((s) => (
                        <tr key={s.equipmentId}>
                          <td><Link to="/equipment">{s.name}</Link></td>
                          <td><span className={`badge ${s.available === 0 ? 'badge-unpaid' : s.available <= s.totalQty * 0.2 ? 'badge-partial' : 'badge-paid'}`}>{s.available}</span></td>
                          <td>{s.totalQty}</td>
                        </tr>
                      ))}
                      {d.stock.length === 0 && <tr><td colSpan={3} className="empty-state">No equipment added yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Latest receipts</h3></div>
              {d.recentPayments.length === 0 ? <div className="empty-state">No payments recorded yet.</div> : (
                <table>
                  <thead><tr><th>Receipt</th><th>Date</th><th>Member</th><th>Amount</th></tr></thead>
                  <tbody>
                    {d.recentPayments.map((p) => (
                      <tr key={p.paymentId}>
                        <td><Link to={`/receipts/${p.paymentId}`}>#{p.receiptNo}</Link></td>
                        <td>{p.paidDate}</td>
                        <td><Link to={`/members/${p.memberId}`}>{p.memberName}</Link></td>
                        <td>{money(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
