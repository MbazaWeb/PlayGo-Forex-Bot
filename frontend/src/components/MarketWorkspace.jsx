import DailyMarkets from './DailyMarkets';
import AccountActivity from './AccountActivity';
import React from 'react';
import { ArrowUpRight, ChartCandlestick, ChartNoAxesCombined } from 'lucide-react';
import TerminalOrder from './TerminalOrder';
import MarketExplorer, { useMarketList } from './MarketExplorer';

export default function MarketWorkspace({ page, changePage, marketSymbol, onMarketChange, account, executionEnabled, initialDuration }) {
  const catalog = useMarketList(marketSymbol, onMarketChange);
  const go = (next, symbol, duration) => {
    if (typeof changePage === 'function') changePage(next, symbol, duration);
  };
  const rows = catalog.rows || [];

  if (page === 'Overview') {
    return (
      <>
        <div className="dashboard-grid">
          <MarketExplorer catalog={catalog} overview />
          <section className="panel activity-panel">
            <div className="panelhead">
              <div><h2>Quick Actions</h2><p>Manage your workspace</p></div>
            </div>
            <button onClick={() => go('Trading Terminal')}><ChartCandlestick size={20} /> Open Trading Terminal <ArrowUpRight size={16} /></button>
            <button onClick={() => go('Bot Agents')}><ChartNoAxesCombined size={20} /> Open Bot Agents <ArrowUpRight size={16} /></button>
            <button onClick={() => go('Analytics')}><ChartNoAxesCombined size={20} /> View Performance <ArrowUpRight size={16} /></button>
          </section>
        </div>
        <DailyMarkets rows={rows} go={go} />
        <section className="panel">
          <div className="panelhead">
            <div><h2>Markets</h2><p>Live Deriv symbols</p></div>
            <button className="textlink" onClick={() => go('Trading Terminal')}>Open terminal <ArrowUpRight size={15} aria-hidden="true" /></button>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>MARKET</th><th>SYMBOL</th><th>GROUP</th><th></th></tr></thead>
              <tbody>
                {rows.slice(0, 12).map(market => (
                  <tr key={market.symbol}>
                    <td><b>{market.name}</b></td>
                    <td className="muted">{market.symbol}</td>
                    <td className="muted">{market.group}</td>
                    <td><button className="mini-link" onClick={() => go('Trading Terminal', market.symbol)}>View <ArrowUpRight size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
    <div className="terminal-workspace">
      <MarketExplorer catalog={catalog} />
      <TerminalOrder key={account?.accountRef} initialDuration={initialDuration} account={account} market={catalog.market}
        executionEnabled={executionEnabled} openBot={() => go('Bot Agents', catalog.market?.symbol)} />
    </div>
    {account && <AccountActivity key={account.accountRef} accountRef={account.accountRef}
      currency={account.currency} openAnalytics={() => go('Analytics')} />}
    </>
  );
}
