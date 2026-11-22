import React, { useState } from 'react';

const SYMBOL_RE = /^[A-Za-z0-9_]{2,30}$/;

export default function Portfolio({ accountId, accountType }) {
  const base = '/api/demo';
  const [view, setView] = useState(null);
  const [direction, setDirection] = useState('CALL');
  const [minutes, setMinutes] = useState(15);
  const [stake, setStake] = useState(1);
  const [symbol, setSymbol] = useState('frxEURUSD');

  const numericStake = Number(stake);
  const numericMinutes = Number(minutes);
  const quoteReady =
    SYMBOL_RE.test(symbol) &&
    Number.isInteger(numericMinutes) &&
    numericMinutes >= 1 &&
    numericMinutes <= 60 &&
    Number.isFinite(numericStake) &&
    numericStake > 0 &&
    numericStake <= 1;

  if (accountType !== 'demo' || typeof accountId !== 'string' || !accountId) {
    return (
      <section className="panel account-panel">
        <h3>Demo account required</h3>
        <p>Portfolio tools are available for demo accounts only; real-money portfolios are unavailable.</p>
      </section>
    );
  }

  async function refresh(kind) {
    setView({ loading: true });
    try {
      const params = new URLSearchParams({ account: accountId });
      if (kind === 'quote') {
        params.set('symbol', symbol);
        params.set('direction', direction);
        params.set('minutes', String(numericMinutes));
        params.set('stake', String(numericStake));
      }
      const response = await fetch(`${base}/${kind}?` + params.toString());
      if (response.status === 401) return setView({ expired: true });
      if (response.status === 429) return setView({ limited: true });
      if (!response.ok) throw new Error();
      const body = await response.json();
      setView(body);
    } catch {
      setView({ error: true });
    }
  }

  const busy = !!view?.loading;

  return (
    <section className="panel account-panel">
      <h3>Demo contracts - {accountId}</h3>

      <button className="outline" disabled={busy} onClick={() => refresh('portfolio')}>
        Read open contracts
      </button>
      <button className="outline" disabled={busy} onClick={() => refresh('history')}>
        Read closed trades
      </button>

      <fieldset>
        <legend>Demo quote</legend>
        <label>
          Market symbol
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.trim())}
            placeholder="e.g. frxEURUSD, R_75"
            maxLength={30}
          />
        </label>
        <label>
          Direction
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option>CALL</option>
            <option>PUT</option>
          </select>
        </label>
        <label>
          Minutes
          <input
            type="number"
            min="1"
            max="60"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label>
          Stake
          <input
            type="number"
            min="0.01"
            max="1"
            step="0.01"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
          />
        </label>
        <button
          className="outline"
          disabled={busy || !quoteReady}
          onClick={() => refresh('quote')}
        >
          Quote {symbol || 'market'}
        </button>
      </fieldset>

      {view?.expired && <a href="/api/auth/deriv/start">Sign in again with Deriv</a>}
      {view?.limited && <p>Deriv rate limit reached. Try again later.</p>}

      <button className="outline" disabled={busy} onClick={() => refresh('operations')}>
        Execution and risk
      </button>

      {view?.status && (
        <p>
          Account switch {view.status.paused ? 'paused' : 'armed'} - Realized P&L today (UTC){' '}
          {view.status.dailyRealizedPnl ?? 'unverified'} - Last completed recovery{' '}
          {view.status.lastRecoveryAt
            ? new Date(view.status.lastRecoveryAt).toLocaleString()
            : 'never recorded'}
        </p>
      )}

      {view?.limits && (
        <>
          <p>
            {view.worker} - Max stake {view.limits.maxStake} - Daily loss limit{' '}
            {view.limits.maxDailyLoss} - Open limit {view.limits.maxOpenContracts} - Cooldown{' '}
            {view.limits.minSecondsBetweenTrades}s
          </p>
          {view.intents?.length
            ? view.intents.map((r, i) => (
                <p key={i}>
                  {r.strategy_id} - {r.symbol} - {r.status} - {r.updated_at}
                </p>
              ))
            : <p>No recorded execution intents.</p>}
        </>
      )}

      {view?.proposal && (
        <p>
          {view.symbol} {view.tick?.price} - Ask {view.proposal.ask} - Payout{' '}
          {view.proposal.payout} {view.currency} -{' '}
          {view.tick ? new Date(view.tick.epoch * 1000).toLocaleTimeString() : ''}
        </p>
      )}

      {view?.transactions && (
        <>
          <p>
            Latest {view.transactions.length} closed trades -{' '}
            {view.observedAt ? new Date(view.observedAt).toLocaleString() : ''}
          </p>
          {view.transactions.map((t) => (
            <p key={t.id}>
              {t.id} - Bought {t.buy} - Sold {t.sell}
            </p>
          ))}
        </>
      )}

      <div role="status">
        {view?.loading && 'Connecting to Deriv...'}
        {view?.error && 'Broker portfolio unavailable.'}
        {view?.contracts && (
          <>
            <p>
              Broker snapshot -{' '}
              {view.observedAt ? new Date(view.observedAt).toLocaleString() : ''}
            </p>
            {view.contracts.length
              ? view.contracts.map((c) => <p key={c.id}>{c.id} {c.symbol}</p>)
              : 'No open contracts.'}
          </>
        )}
      </div>
    </section>
  );
}