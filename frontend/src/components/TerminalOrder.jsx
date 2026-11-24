import { publicRequest, supportedTradeDurations } from './derivMarkets';
import ConfirmDialog from './ConfirmDialog';
import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Bot } from 'lucide-react';

const DURATIONS = [1, 5, 15, 60];
const ACTIONS = { buy: 'Buy / Rise', sell: 'Sell / Fall', bot: 'Bot Trade' };

export default function TerminalOrder({ account, accounts, onSelectAccount, market, executionEnabled, openBot, initialDuration }) {
  const [preferredDuration, setDuration] = useState(initialDuration ?? 5);
  const [contractOptions, setContractOptions] = useState(null);
  const [durationAttempt, retryDurations] = useState(0);
  const symbol = market?.symbol;
  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    publicRequest({ contracts_for: symbol }, controller.signal)
      .then(response => supportedTradeDurations(response, DURATIONS))
      .then(options => { if (!controller.signal.aborted) setContractOptions({ symbol, durationAttempt, options }); })
      .catch(() => { if (!controller.signal.aborted) setContractOptions({ symbol, durationAttempt, error: true }); });
    return () => controller.abort();
  }, [symbol, durationAttempt]);

  const availability = contractOptions && contractOptions.symbol === symbol && contractOptions.durationAttempt === durationAttempt ? contractOptions : null;
  const listedDurations = DURATIONS.filter(minutes =>
    availability?.options?.CALL.includes(minutes) || availability?.options?.PUT.includes(minutes));
  const useQuoteFallback = Boolean(symbol && availability && !listedDurations.length);
  const durations = useQuoteFallback ? DURATIONS : listedDurations;
  const duration = durations.includes(preferredDuration) ? preferredDuration : durations[0];
  const buyAvailable = useQuoteFallback || availability?.options?.CALL.includes(duration);
  const sellAvailable = useQuoteFallback || availability?.options?.PUT.includes(duration);
  const actionAvailable = action => action === 'buy' ? buyAvailable : action === 'sell' ? sellAvailable : buyAvailable && sellAvailable;
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const scale = account?.currency === 'USD' ? 100 : 1e8;
  const stake = Math.floor(Number(account?.balance) * 0.01 * scale) / scale;
  const real = account?.account_type === 'real';
  const funds = real ? 'real funds' : 'virtual funds';
  const blocker = !account ? (accounts?.length ? 'Choose an account to trade.' : 'No Deriv accounts available.')
    : real && !executionEnabled ? 'Real-money execution is disabled.'
      : !(stake > 0) ? 'The selected account needs an available balance.'
        : market?.status !== 'Open' ? (market?.status === 'Closed' || market?.status === 'Suspended' ? 'Market ' + market.status.toLowerCase() + '.' : 'Waiting for an open market.') : '';

  async function submit(action) {
    if (busy || blocker || !actionAvailable(action)) return;
    setBusy(action);
    setResult(null);
    try {
      const query = new URLSearchParams({
        account: account.account_id, symbol: market.symbol,
        granularity: String(duration * 60), terminalAction: action, orderRequestId: crypto.randomUUID(),
      });
      const response = await fetch('/api/agent/place?' + query, {
        method: 'POST', headers: { 'X-PlayGo-Request': '1' },
      });
      const body = await response.json();
      const order = body.accounts?.[0];
      if (!response.ok || !order) throw Error(body.error || 'Trade request failed.');
      const databaseError = /^REAL_EXECUTION_DATABASE_/.test(order.reason || '');
      const rejection = /^DERIV_([A-Z_]+?)_REJECTED(?:_([A-Za-z0-9_]+))?$/.exec(order.reason || '');
      const message = rejection
        ? `Deriv rejected the ${rejection[1].toLowerCase().replaceAll('_', ' ')} request${rejection[2] ? ' (' + rejection[2] + ')' : ''}. ${order.detail || 'No order placed.'}`
        : databaseError
        ? 'The trading database is unavailable. Check Account Activity before retrying.'
        : order.reason === 'ORDER_OUTCOME_UNKNOWN'
        ? 'Deriv did not confirm the order outcome. Check Open Trades before trying again.'
        : order.status === 'ordered'
        ? `Deriv accepted contract ${order.contractId}.`
        : `No new order placed. ${(order.reason || order.status).replaceAll('_', ' ')}.`;
      if (order.status === 'ordered') window.dispatchEvent(new CustomEvent('playgo:position', { detail: account.account_id }));
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
      <p>{market?.name || 'Select market'}</p>
      <div className="terminal-ticket-fields">
      <label>Deriv account
        <select value={account?.account_id || ''} disabled={!accounts?.length || Boolean(busy)}
          onChange={event => onSelectAccount(event.target.value)}>
          <option value="" disabled>Choose account</option>
          {accounts?.map(item => <option key={item.account_id} value={item.account_id}>
            {item.account_type === 'demo' ? 'Demo' : 'Real'} / {item.account_id}
          </option>)}
        </select>
      </label>
      <label>Duration
        <select value={duration ?? ''} disabled={Boolean(busy || !durations.length)} onChange={event => setDuration(Number(event.target.value))}>
          {!durations.length && <option value="">Unavailable</option>}
          {durations.map(minutes => <option key={minutes} value={minutes}>{minutes} min</option>)}
        </select>
      </label>
      </div>
      {blocker && <p className="terminal-order-status" role="status">{blocker}</p>}
      {!blocker && !availability && <p role="status" className="terminal-order-status">Loading contract durations...</p>}
      {!blocker && useQuoteFallback && <p role="status" className="terminal-order-status">
        Try 5 minutes or choose another duration. Deriv will confirm availability when you request a quote.
        <button type="button" className="textlink" disabled={Boolean(busy)} onClick={() => retryDurations(value => value + 1)}>Refresh durations</button>
      </p>}
      {!blocker && durations.length > 0 && !(buyAvailable && sellAvailable) &&
        <p role="status" className="terminal-order-status">Only {buyAvailable ? 'Rise' : 'Fall'} is offered at this duration.</p>}
      <div className="terminal-order-directions">
        <button type="button" className="primary" disabled={Boolean(busy || blocker || !actionAvailable('buy'))} onClick={() => setReview('buy')}><ArrowUpRight size={16} /> Buy / Rise</button>
        <button type="button" className="outline terminal-sell" disabled={Boolean(busy || blocker || !actionAvailable('sell'))} onClick={() => setReview('sell')}><ArrowDownRight size={16} /> Sell / Fall</button>
      </div>
      <button type="button" className="outline" disabled={Boolean(busy || blocker || !actionAvailable('bot'))} onClick={() => setReview('bot')}><Bot size={16} /> Bot Trade</button>
      <button type="button" className="textlink" onClick={openBot}>Bot Agents</button>
      {(busy || result) && <p className="terminal-order-status" role="status">{busy ? 'Checking with Deriv...' : result}</p>}
      {review && actionAvailable(review) && <ConfirmDialog title={ACTIONS[review]} confirmLabel={review === 'bot' ? 'Check and trade' : 'Place order'}
        onCancel={() => setReview(null)} onConfirm={() => { setReview(null); void submit(review); }}>
        <dl className="trade-review">
          <div><dt>Market</dt><dd>{market?.name}</dd></div>
          <div><dt>Deriv {real ? 'Real' : 'Demo'}</dt><dd>{account?.account_id}</dd></div>
          <div><dt>Estimated stake</dt><dd>{stake} {account?.currency}</dd></div>
          <div><dt>Duration</dt><dd>{duration} min</dd></div>
        </dl>
        <p>{funds === 'real funds' ? 'Real funds.' : 'Virtual funds.'}{review === 'bot' && ' Trades only if the setup qualifies.'}</p>
      </ConfirmDialog>}
    </section>
  );
}
