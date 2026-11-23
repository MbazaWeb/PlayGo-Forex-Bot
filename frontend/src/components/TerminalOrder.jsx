import ConfirmDialog from './ConfirmDialog';
import React, { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Bot } from 'lucide-react';

const DURATIONS = [1, 5, 15, 60];
const ACTIONS = { buy: 'Buy / Rise', sell: 'Sell / Fall', bot: 'Bot Trade' };

export default function TerminalOrder({ account, market, executionEnabled, openBot }) {
  const [duration, setDuration] = useState(5);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const stake = Math.floor(Number(account?.balance) * 0.01 * 1e8) / 1e8;
  const real = account?.account_type === 'real';
  const funds = real ? 'real funds' : 'virtual funds';
  const blocker = !account ? 'Select a Deriv account.'
    : real && !executionEnabled ? 'Real-money execution is disabled.'
      : !(stake > 0) ? 'The selected account needs an available balance.'
        : market?.status !== 'Open' ? 'Select an open market.' : '';

  async function submit(action) {
    if (busy || blocker) return;
    setBusy(action);
    setResult(null);
    try {
      const query = new URLSearchParams({
        account: account.account_id, symbol: market.symbol,
        granularity: String(duration * 60), terminalAction: action,
      });
      const response = await fetch('/api/agent/place?' + query, {
        method: 'POST', headers: { 'X-PlayGo-Request': '1' },
      });
      const body = await response.json();
      const order = body.accounts?.[0];
      if (!response.ok || !order) throw Error(body.error || 'Trade request failed.');
      const databaseError = /^REAL_EXECUTION_DATABASE_/.test(order.reason || '');
      const message = databaseError
        ? 'The trading database is unavailable. Check Account Activity before retrying.'
        : order.status === 'ordered'
        ? `Deriv accepted contract ${order.contractId}.`
        : `No new order placed. ${(order.reason || order.status).replaceAll('_', ' ')}.`;
      setResult(message);
    } catch (error) {
      setResult(error.message || 'Order status unavailable. Check Account Activity before retrying.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel terminal-order" aria-label="Trade now">
      <h2>Trade Now</h2>
      <p>{market?.name || 'Select market'}{account && ` / Deriv ${real ? 'Real' : 'Demo'}`}</p>
      <label>Contract duration
        <select value={duration} disabled={Boolean(busy)} onChange={event => setDuration(Number(event.target.value))}>
          {DURATIONS.map(minutes => <option key={minutes} value={minutes}>{minutes} min</option>)}
        </select>
      </label>
      {stake > 0 && <p>Estimated stake {stake} {account.currency} ({funds})</p>}
      <div className="terminal-order-directions">
        <button type="button" className="primary" disabled={Boolean(busy || blocker)} onClick={() => setReview('buy')}><ArrowUpRight size={16} /> Buy / Rise</button>
        <button type="button" className="outline terminal-sell" disabled={Boolean(busy || blocker)} onClick={() => setReview('sell')}><ArrowDownRight size={16} /> Sell / Fall</button>
      </div>
      <small>Rise and Fall open directional Options contracts. One-time orders can run to expiry.</small>
      <button type="button" className="outline" disabled={Boolean(busy || blocker)} onClick={() => setReview('bot')}><Bot size={16} /> Bot Trade</button>
      <small>Checks the market once and trades if the bot finds a qualifying setup.</small>
      <button type="button" className="textlink" onClick={openBot}>Open Bot Agents for scheduled trading</button>
      {(busy || blocker || result) && <p role="status">{busy ? 'Checking with Deriv...' : result || blocker}</p>}
      {review && <ConfirmDialog title={ACTIONS[review]} confirmLabel={review === 'bot' ? 'Check and trade' : 'Place order'}
        onCancel={() => setReview(null)} onConfirm={() => { setReview(null); void submit(review); }}>
        <dl className="trade-review">
          <div><dt>Market</dt><dd>{market?.name}</dd></div>
          <div><dt>Deriv {real ? 'Real' : 'Demo'}</dt><dd>{account?.account_id}</dd></div>
          <div><dt>Estimated stake</dt><dd>{stake} {account?.currency}</dd></div>
          <div><dt>Duration</dt><dd>{duration} min</dd></div>
        </dl>
        <p>{review === 'bot' ? 'Deriv receives an order if the setup qualifies.' : 'Confirm to submit this directional contract to Deriv.'} This uses {funds}.</p>
      </ConfirmDialog>}
    </section>
  );
}
