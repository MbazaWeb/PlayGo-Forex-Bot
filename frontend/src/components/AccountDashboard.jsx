import { brokerRequest } from './brokerRequest';
import { summarizeClosedTrades } from './tradePerformance';
import React, { useEffect, useState } from 'react';
import { Wallet, ShieldCheck } from 'lucide-react';
import Metric from './Metric';
import AccountActivity from './AccountActivity';
import { downloadTradePdf, downloadTradeReport } from './tradeReport';

const settlementFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Dar_es_Salaam', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

const MarketChart = React.lazy(() => import('./MarketChart'));
const MarketWorkspace = React.lazy(() => import('./MarketWorkspace'));

export default function AccountDashboard({ accounts, mt5, navigate, marketSymbol, onMarketChange, analytics = false }) {
  const account = accounts?.[0];
  const id = account?.account_id;
  const [history, setHistory] = useState(null);

  useEffect(() => {
    if (!id) {
      setHistory(null);
      return;
    }
    const controller = new AbortController();
    let timer;
    let refreshing = false;
    let refreshPending = false;
    async function refresh() {
      if (refreshing) { refreshPending = true; return; }
      clearTimeout(timer);
      refreshing = true;
      try {
        const res = await brokerRequest('/api/history?account=' + encodeURIComponent(id), { signal: controller.signal });
        if (!res.ok) throw new Error('history unavailable');
        const body = await res.json();
        if (body?.accountId !== id || !Array.isArray(body.transactions)) throw new Error('unexpected payload');
        const points = body.transactions
          .slice()
          .reverse()
          .map((t) => {
            if (t?.sell == null || t?.buy == null) return null;
            const sell = Number(t.sell);
            const buy = Number(t?.buy);
            if (!Number.isFinite(sell) || !Number.isFinite(buy)) return null;
            const value = Number((sell - buy).toFixed(8));
            return { time: String(t.id), contractId: t.contractId, buy, sell, settledAt: t.settledAt, value, status: value > 0 ? 'Win' : value < 0 ? 'Loss' : 'Break-even' };
          })
          .filter(Boolean);
        if (!controller.signal.aborted) setHistory({ id, points, today: body.today });
      } catch {
        if (!controller.signal.aborted) setHistory({ id, error: true });
      } finally {
        refreshing = false;
        if (!controller.signal.aborted) {
          const delay = refreshPending ? 0 : 15_000;
          refreshPending = false;
          timer = setTimeout(refresh, delay);
        }
      }
    }
    function onSettlement(event) {
      if (event.detail === id) void refresh();
    }
    window.addEventListener('playgo:settlement', onSettlement);
    void refresh();
    return () => {
      window.removeEventListener('playgo:settlement', onSettlement);
      clearTimeout(timer);
      controller.abort();
    };
  }, [id]);

  const result = history?.id === id ? history : null;
  const points = result?.points;
  const today = result?.today;
  const performance = points?.length ? summarizeClosedTrades(points) : null;
  const currency = account?.currency ?? '';
  const signedMoney = value => value == null ? '-'
    : (value >= 0.005 ? '+' : '') + (Math.abs(value) < 0.005 ? '0.00' : value.toFixed(2)) + (currency ? ' ' + currency : '');
  const wins = points?.filter((t) => t.value > 0).length ?? 0;
  const losses = points?.filter(t => t.status === 'Loss').length ?? 0;
  const even = (points?.length ?? 0) - wins - losses;
  const winRate = points?.length ? (100 * wins / points.length).toFixed(1) + '%' : '—';

  return (
    <>
      <section aria-label="Today's trading results">
          <div className="panelhead"><div><h2>Today</h2><p>Settled trades · Tanzania time</p></div></div>
          <div className="metrics three">
            <Metric title="Today's Wins" value={today?.wins ?? '-'} icon={ShieldCheck} positive />
            <Metric title="Today's Losses" value={today?.losses ?? '-'} icon={ShieldCheck} positive={false} />
            <Metric title="Total Trades Today" value={today?.total ?? '-'} icon={ShieldCheck} />
          </div>
          {id && result && !today && <p role="status">Today's totals are unavailable.</p>}
      </section>
      <div className="metrics three">
        <Metric
          title="Total Portfolio Balance"
          value={account?.balance == null ? 'Unavailable' : account.balance + ' ' + currency}
          change={id ? 'Selected account ' + id : 'No account'}
          icon={Wallet}
        />
        <Metric
          title="Win Rate"
          value={winRate}
          change="Recent closed trades"
          icon={ShieldCheck}
        />
        <Metric
          title="Realized P&L"
          value={points?.length ? points.reduce((sum, point) => sum + point.value, 0).toFixed(2) + ' ' + currency : '—'}
          change="Recent settled trades"
          icon={ShieldCheck}
          positive={!!points?.length && points.reduce((sum, point) => sum + point.value, 0) >= 0}
        />
      </div>

      {analytics && (
        <section aria-label="Profitability">
          <div className="panelhead analytics-report-head">
            <div><h2>Profitability</h2><p>Selected account · {points?.length ?? 0} recent settled trades · includes bot and manual trades</p></div>
            <div className="analytics-report-actions">
            <button type="button" className="outline" disabled={!points?.length}
              onClick={() => downloadTradeReport({ id, currency, points, performance, wins, losses, even, settlementFormat })}>
              Download Excel report
            </button>
            <button type="button" className="outline" disabled={!points?.length}
              onClick={() => downloadTradePdf({ id, currency, points, performance, wins, losses, even, settlementFormat })}>
              Download PDF report
            </button>
            </div>
          </div>
          <div className="metrics performance-metrics">
            <Metric title="Net P&L" value={signedMoney(performance?.net)} change="Total gains minus losses" positive={performance?.net > 0} />
            <Metric title="Expectancy per trade" value={signedMoney(performance?.average)} change="Net P&L divided by settled trades" positive={performance?.average > 0} />
            <Metric title="Profit factor" value={performance?.profitFactor == null ? '-' : performance.profitFactor.toFixed(2) + '×'}
              change={performance && losses === 0 ? 'No losses in this sample' : 'Gross gains ÷ gross losses'} />
            <Metric title="Maximum drawdown" value={performance ? performance.drawdown.toFixed(2) + (currency ? ' ' + currency : '') : '-'}
              change="Largest drop in cumulative closed P&L" />
            <Metric title="Average win" value={signedMoney(performance?.averageWin)} positive />
            <Metric title="Average loss" value={signedMoney(performance?.averageLoss)} />
          </div>
        </section>
      )}

      {!analytics && (
        <React.Suspense fallback={<p>Loading markets...</p>}>
          <MarketWorkspace page="Overview" changePage={navigate} marketSymbol={marketSymbol} onMarketChange={onMarketChange} />
        </React.Suspense>
      )}

      <section className="panel account-panel">
        <div className="panelhead">
          <div>
            <h2>Trade performance</h2>
            <p>Realized P&L per trade{currency ? ' (' + currency + ')' : ''}</p>
          </div>
        </div>

        {points?.length ? (
          <React.Suspense fallback={<p>Loading chart...</p>}>
            <MarketChart data={points} outcomes label={currency ? `P&L (${currency})` : 'P&L'} />
          </React.Suspense>
        ) : (
          <p role="status">
            {!id
              ? 'An account is required.'
              : result?.error
                ? 'Broker history unavailable.'
                : points
                  ? 'No closed trades reported.'
                  : 'Loading broker history...'}
          </p>
        )}

      </section>

      {!analytics && (
        <div className="panelhead">
          <button className="outline" onClick={() => navigate?.('Bot Agents')}>View Bot Agents</button>
        </div>
      )}
      {id && <AccountActivity key={id} accountId={id} currency={currency} openAnalytics={analytics ? undefined : () => navigate('Analytics')} />}
    </>
  );
}