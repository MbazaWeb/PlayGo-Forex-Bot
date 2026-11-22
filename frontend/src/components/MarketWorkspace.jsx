import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Bot, Plus, ChartCandlestick, ChartNoAxesCombined, Zap } from 'lucide-react';
import { markets } from './paperMarkets';
import Ticket from './ticket';
import MarketExplorer, { useMarketList } from './MarketExplorer';

const DerivDemoActivity = React.lazy(() => import('../DerivDemoActivity'));
const currency = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

function BotPerformance({ accountId, accountType, changePage }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!accountId || accountType !== 'demo') return;
    const ctrl = new AbortController();
    const base = '/api/demo/strategy?';
    (async () => {
      try {
        const r = await fetch(base + new URLSearchParams({ account: accountId }), { signal: ctrl.signal });
        if (!r.ok) throw new Error();
        const body = await r.json();
        if (!ctrl.signal.aborted) setState(body.strategy || {});
      } catch { if (!ctrl.signal.aborted) setState({ error: true }); }
    })();
    return () => ctrl.abort();
  }, [accountId, accountType]);

  if (!accountId) return <p role="status">Connect a Deriv account to see live bot state.</p>;
  if (!state) return <p role="status">Loading bot state...</p>;
  if (state.error) return <p role="status">Bot state unavailable.</p>;

  const packs = [
    { id: 'moving-average-crossover', label: 'Momentum Alpha' },
    { id: 'rsi-momentum', label: 'RSI Reversal' },
    { id: 'bollinger-bands-reversion', label: 'Trend Hunter' },
  ];

  return (
    <>
      {packs.map((p) => {
        const isActive = state.pack_id === p.id;
        return (
          <div className="bot-row" key={p.id}>
            <span className={'bot-icon ' + (isActive && state.enabled ? 'running' : '')}><Bot size={20} /></span>
            <div className="bot-info">
              <b>{p.label}</b>
              <small>{isActive ? (state.enabled ? '● Enabled' : '● Paused') : '● Not selected'}</small>
            </div>
            <div className="bot-values">
              <b className={isActive && state.paper_pnl > 0 ? 'gain' : isActive && state.paper_pnl < 0 ? 'loss' : ''}>
                {isActive && Number.isFinite(state.paper_pnl) ? currency(state.paper_pnl) : '-'}
              </b>
              <small>{isActive ? (state.paper_trades ?? 0) + ' trades' : 'no data'}</small>
            </div>
          </div>
        );
      })}
      <button className="outline wide" onClick={() => changePage('Trading Bots')}>
        <Plus size={16} /> Configure Trading Bot
      </button>
    </>
  );
}

export default function MarketWorkspace({ page, changePage, initialSymbol, accounts }) {
  const catalog = useMarketList(initialSymbol);
  const demoAccounts = (accounts || []).filter((a) =>
    typeof a.account_id === 'string' && a.account_id && a.account_type === 'demo',
  );
  const [selectedDemoId, setSelectedDemoId] = useState('');
  const firstAccount = demoAccounts.find((a) => a.account_id === selectedDemoId) || demoAccounts[0];
  const go = (next, symbol) => { if (typeof changePage === 'function') changePage(next, symbol); };

  const liveRows = markets.map((m) => {
    const live = catalog.rows?.find((r) => r.symbol === m.symbol);
    return live ? { ...m, name: live.name, group: live.group } : m;
  });

  if (page === 'Overview') {
    return (
      <>
        <div className="dashboard-grid">
          <MarketExplorer catalog={catalog} overview />
          <section className="panel bot-panel">
            <div className="panelhead">
              <div><h2>Bot Performance</h2><p>Live account state</p></div>
              <button className="textlink" onClick={() => go('Trading Bots')}>View all →</button>
            </div>
            <BotPerformance
              accountId={firstAccount?.account_id}
              accountType={firstAccount?.account_type}
              changePage={go}
            />
          </section>
        </div>
        <div className="bottom-grid">
          <section className="panel">
            <div className="panelhead">
              <div><h2>Watchlist</h2><p>Real Deriv symbols - prices load in chart</p></div>
              <button className="textlink" onClick={() => go('Trading Terminal')}>Trade markets →</button>
            </div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>MARKET</th><th>SYMBOL</th><th>GROUP</th><th>TYPE</th><th></th></tr></thead>
                <tbody>
                  {liveRows.slice(0, 12).map((m) => (
                    <tr key={m.symbol}>
                      <td><b>{m.name}</b></td>
                      <td className="muted">{m.symbol}</td>
                      <td className="muted">{m.group}</td>
                      <td className="muted">{firstAccount?.account_type || '-'}</td>
                      <td><button className="mini-link" onClick={() => go('Trading Terminal', m.symbol)}>View <ArrowUpRight size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel activity-panel">
            <div className="panelhead"><div><h2>Quick Actions</h2><p>Manage your workspace</p></div></div>
            <button onClick={() => go('Trading Terminal')}><ChartCandlestick size={20} /> Open Trading Terminal <ArrowUpRight size={16} /></button>
            <button onClick={() => go('Trading Bots')}><Zap size={20} /> Configure a Strategy <ArrowUpRight size={16} /></button>
            <button onClick={() => go('Analytics')}><ChartNoAxesCombined size={20} /> View Performance <ArrowUpRight size={16} /></button>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      {demoAccounts.length > 1 && (
        <label className="terminal-demo-account-select">
          Deriv demo account
          <select value={firstAccount?.account_id || ''} onChange={(e) => setSelectedDemoId(e.target.value)}>
            {demoAccounts.map((account) => (
              <option key={account.account_id} value={account.account_id}>{account.account_id}</option>
            ))}
          </select>
        </label>
      )}
      <div className="terminal-grid">
        <MarketExplorer catalog={catalog} />
        <Ticket accounts={firstAccount ? [firstAccount] : []} catalog={catalog} />
      </div>
      <React.Suspense fallback={<p>Loading Deriv demo account...</p>}>
        <DerivDemoActivity account={firstAccount} />
      </React.Suspense>
    </>
  );
}