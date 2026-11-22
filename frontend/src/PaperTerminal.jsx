import React, { useEffect, useMemo, useState } from 'react';
import { paperRisk } from './paperRisk.js';

const KEY = 'playgo.paper.v1';
const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD'];
const initial = { cash: 10000, positions: [], history: [], halted: false };

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initial;
    const v = JSON.parse(raw);
    if (!v || !Array.isArray(v.positions) || !Array.isArray(v.history) || !Number.isFinite(v.cash))
      return initial;
    return { halted: false, ...v };
  } catch {
    return initial;
  }
}

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaperTerminal() {
  const [ledger, setLedger] = useState(read);
  const [pair, setPair] = useState(PAIRS[0]);
  const [price, setPrice] = useState('1.1000');
  const [units, setUnits] = useState('100');
  const [side, setSide] = useState('buy');
  const [message, setMessage] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ledger));
    } catch {
      setMessage('Could not persist paper ledger to local storage.');
    }
  }, [ledger]);

  const p = Number(price);
  const q = Number(units);
  const validPrice = Number.isFinite(p) && p > 0;

  const { exposure, equity, balance, freeMargin } = useMemo(() => {
    let exp = 0;
    let eq = ledger.cash;
    for (const x of ledger.positions) {
      exp += x.units * x.entry;
      const mark = validPrice && x.pair === pair ? p : x.entry;
      const pnl = (x.side === 'buy' ? 1 : -1) * (mark - x.entry) * x.units;
      eq += x.units * x.entry + pnl;
    }
    return { exposure: exp, equity: eq, balance: ledger.cash + exp, freeMargin: eq - exp };
  }, [ledger, pair, p, validPrice]);

  const wins = ledger.history.filter((t) => t.pnl > 0);
  const losses = ledger.history.filter((t) => t.pnl < 0);
  const total = (trades) => trades.reduce((s, t) => s + (Number.isFinite(t.pnl) ? t.pnl : 0), 0);

  const signed = (amt) =>
    amt === 0 ? '$0.00' : (amt > 0 ? '+' : '−') + '$' + fmt(Math.abs(amt));

  const rejection = paperRisk(ledger, { price: p, units: q });

  function open() {
    if (rejection) {
      setMessage(rejection);
      return;
    }
    setLedger((v) => {
      if (paperRisk(v, { price: p, units: q })) return v;
      return {
        ...v,
        cash: v.cash - q * p,
        positions: [
          ...v.positions,
          {
            id: crypto.randomUUID(),
            pair,
            side,
            units: q,
            entry: p,
            openedAt: new Date().toISOString(),
          },
        ],
      };
    });
    setMessage('Paper position opened.');
  }

  function close(x) {
    const exit = Number(price);
    if (x.pair !== pair || !Number.isFinite(exit) || exit <= 0) {
      setMessage('Select the position pair and enter a valid manual exit price.');
      return;
    }
    const pnl = (x.side === 'buy' ? 1 : -1) * (exit - x.entry) * x.units;
    setLedger((v) => ({
      ...v,
      cash: v.cash + x.units * x.entry + pnl,
      positions: v.positions.filter((z) => z.id !== x.id),
      history: [
        { ...x, exit, pnl, closedAt: new Date().toISOString() },
        ...v.history,
      ].slice(0, 200),
    }));
    setMessage('Paper position closed at your entered price.');
  }

  function reset() {
    if (!window.confirm('Reset all locally stored paper positions and history?')) return;
    setLedger(initial);
    setMessage('Paper workspace reset.');
  }

  return (
    <section className="panel paper-panel" aria-label="Paper trading terminal">
      <div className="paper-notice" role="note">
        <strong>Paper Simulator (localStorage)</strong>
        <p>Virtual balance and manual scenario prices only. This simulator is separate from Deriv demo and real accounts; no broker orders are sent.</p>
      </div>
      <div className="paper-metrics">
        <div><small>Balance</small><strong>${fmt(balance)}</strong></div>
        <div><small>Equity</small><strong>${fmt(equity)}</strong></div>
        <div><small>Free Margin</small><strong>${fmt(freeMargin)}</strong></div>
      </div>

      <h2 className="paper-subtitle">Trade trends</h2>
      <div className="paper-metrics">
        <div><small>Wins · {wins.length}</small><strong className="gain">{signed(total(wins))}</strong></div>
        <div><small>Losses · {losses.length}</small><strong className="loss">{signed(total(losses))}</strong></div>
        <div><small>Net P/L</small><strong>{signed(total(ledger.history))}</strong></div>
      </div>

      {ledger.history.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Trade</th><th>Result</th><th>P/L (USD)</th></tr></thead>
            <tbody>
              {ledger.history.map((t) => (
                <tr key={t.id}>
                  <td>{t.pair}</td>
                  <td>{t.pnl > 0 ? 'Win' : t.pnl < 0 ? 'Loss' : 'Break-even'}</td>
                  <td className={t.pnl > 0 ? 'gain' : t.pnl < 0 ? 'loss' : undefined}>
                    {signed(t.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="paper-management">
        <summary>Manage paper positions</summary>
        <div className="paper-form">
          <label>Instrument
            <select value={pair} onChange={(e) => setPair(e.target.value)}>
              {PAIRS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>Manual scenario price
            <input type="number" min="0.000001" step="any" value={price}
              onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>Units
            <input type="number" min="1" step="1" value={units}
              onChange={(e) => setUnits(e.target.value)} />
          </label>
          <label>Direction
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
        </div>

        <div className="paper-actions">
          <button className="primary" disabled={!!rejection} onClick={open}>
            Open paper position
          </button>
          <button className="outline"
            onClick={() => setLedger((v) => ({ ...v, halted: !v.halted }))}>
            {ledger.halted ? 'Resume paper entries' : 'Pause paper entries'}
          </button>
          <button className="outline" onClick={reset}>Reset paper workspace</button>
        </div>

        {rejection && <p role="status" className="paper-message">New entry blocked: {rejection}</p>}
        {message && <p role="status" className="paper-message">{message}</p>}

        <h2 className="paper-subtitle">Open paper positions</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Pair</th><th>Side</th><th>Units</th><th>Entry</th><th>Action</th></tr></thead>
            <tbody>
              {ledger.positions.length ? ledger.positions.map((x) => (
                <tr key={x.id}>
                  <td>{x.pair}</td>
                  <td>{x.side}</td>
                  <td>{x.units}</td>
                  <td>{x.entry}</td>
                  <td>
                    <button className="outline" onClick={() => close(x)}>
                      Close at manual price
                    </button>
                  </td>
                </tr>
              )) : <tr><td colSpan="5">No paper positions</td></tr>}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}