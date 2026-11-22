import React, { useEffect, useRef, useState } from 'react';
import { ticketApiBase } from './routing.js';

const SYMBOL_RE = /^[A-Za-z0-9_]{2,30}$/;

function validateOrder({ symbol, stake, minutes }) {
  const errors = [];
  if (!SYMBOL_RE.test(symbol || '')) errors.push('Symbol must be 2-30 alphanumeric characters.');
  const s = Number(stake);
  if (!Number.isFinite(s) || s <= 0) errors.push('Stake must be a positive number.');
  if (s > 1) errors.push('Stake cannot exceed 1 unit on this terminal.');
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 1 || m > 60) errors.push('Duration must be 1-60 whole minutes.');
  return { ok: errors.length === 0, errors };
}

function makeIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'k-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

export default function Ticket({ accounts, catalog }) {
  const [selected, select] = useState('');
  const [direction, setDirection] = useState('CALL');
  const [stake, setStake] = useState('1');
  const [minutes, setMinutes] = useState('15');
  const [gate, setGate] = useState(null);
  const [result, setResult] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);

  const usable = (accounts || []).filter(
    (a) => typeof a.account_id === 'string' && a.account_id
      && (a.account_type === 'demo' || a.account_type === 'real'),
  );
  const account = usable.find((a) => a.account_id === selected)
    || usable.find((a) => a.account_type === 'demo')
    || usable[0];
  const id = account?.account_id;
  const isReal = account?.account_type === 'real';
  const base = ticketApiBase(account?.account_type);

  useEffect(() => {
    if (!id || !base) {
      setGate(null);
      return;
    }
    const ctrl = new AbortController();
    setGate(null);
    fetch(`${base}/ticket?` + new URLSearchParams({ account: id }), { signal: ctrl.signal })
      .then(async (r) => {
        let body = null;
        try { body = await r.json(); } catch { body = null; }
        if (ctrl.signal.aborted) return;
        setGate({
          id,
          ready: r.ok && body?.ready === true,
          message: body?.message || (r.ok ? 'Demo ready.' : 'Demo status unavailable.'),
        });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setGate({ id, ready: false, message: 'Demo status unavailable.' });
      });
    return () => ctrl.abort();
  }, [id, base, refresh]);

  const ready = gate?.id === id && gate?.ready === true;
  const validation = validateOrder({ symbol: catalog?.market?.symbol, stake, minutes });
  const canSubmit = !isReal && !busy && ready && !!catalog?.market && validation.ok && !sent;

  async function submit() {
    if (lock.current || !canSubmit || !base) return;
    lock.current = true;
    setBusy(true);
    setSent(true);
    setResult('');
    try {
      const query = new URLSearchParams({
        account: id,
        symbol: catalog.market.symbol,
        direction,
        stake: String(Number(stake)),
        minutes: String(Number(minutes)),
        key: makeIdempotencyKey(),
      });
      const r = await fetch(`${base}/ticket?` + query, {
        method: 'POST',
        headers: { 'X-PlayGo-Request': '1' },
      });
      const body = await r.json().catch(() => ({}));
      setResult(body?.message || 'Check Portfolio for the order status.');
    } catch {
      setResult('Acknowledgment unavailable. Check Portfolio for the order status.');
    } finally {
      setBusy(false);
      setGate(null);
      setRefresh((n) => n + 1);
      lock.current = false;
    }
  }

  if (isReal) {
    return (
      <section className="panel order-panel">
        <h2>Order ticket unavailable</h2>
        {usable.length > 1 && (
          <label>
            Account
            <select value={id || ''} onChange={(e) => { select(e.target.value); setResult(''); setSent(false); }}>
              {usable.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.account_id} ({a.account_type})
                </option>
              ))}
            </select>
          </label>
        )}
        <p role="status">Real-money trading is not available. Select a demo account to continue.</p>
      </section>
    );
  }

  return (
    <section className="panel order-panel">
      <h2>Demo order ticket</h2>

      {usable.length > 1 ? (
        <label>
          Account
          <select disabled={busy} value={id || ''} onChange={(e) => { select(e.target.value); setResult(''); setSent(false); }}>
            {usable.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.account_id} ({a.account_type})
              </option>
            ))}
          </select>
        </label>
      ) : id ? (
        <p className="terminal-ticket-account">Account {id} ({account.account_type})</p>
      ) : (
        <p role="status">Connect a Deriv account to place orders.</p>
      )}

      <div className="trade-toggle">
        {[['CALL', 'Rise'], ['PUT', 'Fall']].map(([value, label]) => (
          <button
            key={value}
            disabled={busy}
            aria-pressed={direction === value}
            className={direction === value ? (value === 'CALL' ? 'buy' : 'sell') : ''}
            onClick={() => setDirection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="terminal-ticket-market">
        {catalog?.market?.name || 'Select a market in the chart'}
      </p>

      <div className="terminal-order-fields">
        <label>
          Stake ({account?.currency || 'account currency'})
          <input disabled={busy} type="number" min="0.01" max="1" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} />
        </label>
        <label>
          Duration
          <select disabled={busy} value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            {[1, 5, 15, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}
          </select>
        </label>
      </div>

      {!validation.ok && validation.errors.length > 0 && (
        <p role="alert" className="signin-error">{validation.errors[0]}</p>
      )}

      {!ready && id && (
        <p role="status">
          {gate?.id === id ? gate.message : 'Checking demo execution...'}
        </p>
      )}

      {!sent ? (
        <button className="primary wide" disabled={!canSubmit} onClick={submit}>
          Place demo {direction === 'CALL' ? 'Rise' : 'Fall'} order
        </button>
      ) : (
        <button className="outline" disabled={busy || !ready} onClick={() => { setResult(''); setSent(false); }}>
          Prepare another order
        </button>
      )}

      {id && !ready && gate && (
        <button className="textlink" disabled={busy} onClick={() => { setGate(null); setRefresh((n) => n + 1); }}>
          Retry status check
        </button>
      )}

      {result && <p role="status">{result}</p>}
    </section>
  );
}