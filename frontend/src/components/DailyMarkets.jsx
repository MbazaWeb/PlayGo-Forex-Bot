import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarClock } from 'lucide-react';
import { publicRequest, supportedTradeDurations } from './derivMarkets';

const storageKey = 'playgo:trade-plans';
const candidates = [5, 15, 1, 60];
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Dar_es_Salaam', dateStyle: 'medium', timeStyle: 'short',
});
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });

function loadPlans() {
  try {
    const rows = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

export default function DailyMarkets({ rows, go }) {
  const [now, setNow] = useState(Date.now);
  const [plans, setPlans] = useState(loadPlans);
  const [options, setOptions] = useState({});
  const [market, setMarket] = useState(null);
  const [scheduledTime, setScheduledTime] = useState('');
  const [error, setError] = useState('');
  const date = dateKey.format(now);
  const shortlist = useMemo(() => {
    // Rotate by day; show open markets before unavailable ones.
    const ordered = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const seed = [...date].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
    const offset = seed % Math.max(ordered.length, 1);
    const rotated = [...ordered.slice(offset), ...ordered.slice(0, offset)];
    return [...rotated.filter(row => row.status === 'Open'),
      ...rotated.filter(row => row.status !== 'Open')].slice(0, 5);
  }, [rows, date]);

  const symbols = shortlist.map(row => row.symbol).join(',');
  useEffect(() => {
    if (!symbols) return;
    const controller = new AbortController();
    Promise.all(symbols.split(',').map(async symbol => {
      try {
        const response = await publicRequest({ contracts_for: symbol }, controller.signal);
        const { CALL, PUT } = supportedTradeDurations(response, candidates);
        return [symbol, candidates.find(minutes => CALL.includes(minutes) && PUT.includes(minutes))
          ?? candidates.find(minutes => CALL.includes(minutes) || PUT.includes(minutes)) ?? null];
      } catch { return [symbol, null]; }
    })).then(entries => {
      if (!controller.signal.aborted) setOptions(Object.fromEntries(entries));
    });
    return () => controller.abort();
  }, [symbols]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  function save(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setPlans(next);
      setError('');
      return true;
    } catch {
      setError('Could not save the schedule in this browser.');
      return false;
    }
  }

  function schedule(event) {
    event.preventDefault();
    const at = Date.parse(scheduledTime + ':00+03:00');
    if (!market || !Number.isFinite(at) || at <= Date.now()) {
      setError('Choose a future time in EAT.');
      return;
    }
    const next = [...plans, {
      id: crypto.randomUUID(), symbol: market.symbol, name: market.name,
      minutes: options[market.symbol] ?? 5, at,
    }].sort((a, b) => a.at - b.at);
    if (save(next)) { setMarket(null); setScheduledTime(''); }
  }

  return (
    <section className="panel daily-markets" aria-label="Daily markets and trade plans">
      <div className="panelhead"><div><h2>Daily markets</h2><p>{date} · Open markets first</p></div></div>
      {shortlist.length ? <div className="tablewrap"><table>
        <thead><tr><th>Market</th><th>Status</th><th>Suggested duration</th><th>Action</th></tr></thead>
        <tbody>{shortlist.map(row => <tr key={row.symbol}>
          <td>{row.name}</td>
          <td><span className="market-status" data-status={row.status}>{row.status}</span></td>
          <td>{!(row.symbol in options) ? 'Checking…' : options[row.symbol] ? `${options[row.symbol]} min` : '5 min · check quote'}</td>
          <td><button type="button" className="mini-link" onClick={() => { setMarket(row); setError(''); }}>
            <CalendarClock size={16} aria-hidden="true" /> Schedule
          </button></td>
        </tr>)}</tbody>
      </table></div> : <p>Waiting for Deriv market availability.</p>}
      {market && <form className="trade-plan-form" onSubmit={schedule}>
        <label>{market.name} · Date and time (EAT)
          <input type="datetime-local" required step="60" value={scheduledTime} onChange={event => setScheduledTime(event.target.value)} />
        </label>
        <button className="primary" type="submit">Save plan</button>
        <button className="outline" type="button" onClick={() => { setMarket(null); setError(''); }}>Cancel</button>
      </form>}
      {error && <p role="alert">{error}</p>}
      {plans.length > 0 && <div className="trade-plan-list">
        <h3>Planned trades</h3>
        <p>Saved on this browser. Review and confirm each order in Trading Terminal.</p>
        <ul>{plans.map(plan => {
          const due = plan.at <= now;
          return <li key={plan.id}>
            <div><strong>{plan.name}</strong><p>{clock.format(plan.at)} EAT · {plan.minutes} min{due && ' · Due'}</p></div>
            <button className="textlink" type="button" onClick={() => go('Trading Terminal', plan.symbol, plan.minutes)}>
              Review <ArrowUpRight size={15} aria-hidden="true" />
            </button>
            <button className="outline" type="button" onClick={() => save(plans.filter(row => row.id !== plan.id))}>Remove</button>
          </li>;
        })}</ul>
      </div>}
    </section>
  );
}
