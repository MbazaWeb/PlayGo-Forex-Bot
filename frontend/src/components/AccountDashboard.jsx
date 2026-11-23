import React, { useEffect, useState } from 'react';
import { Wallet, ShieldCheck } from 'lucide-react';
import Metric from './Metric';
import AccountActivity from './AccountActivity';

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
    (async () => {
      try {
        const res = await fetch('/api/history?account=' + encodeURIComponent(id), { signal: controller.signal });
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
            return { time: String(t.id), value, status: value > 0 ? 'Win' : value < 0 ? 'Loss' : 'Break-even' };
          })
          .filter(Boolean);
        if (!controller.signal.aborted) setHistory({ id, points });
      } catch {
        if (!controller.signal.aborted) setHistory({ id, error: true });
      }
    })();
    return () => controller.abort();
  }, [id]);

  const result = history?.id === id ? history : null;
  const points = result?.points;
  const currency = account?.currency ?? '';
  const wins = points?.filter((t) => t.value > 0).length ?? 0;
  const losses = points?.filter(t => t.status === 'Loss').length ?? 0;
  const even = (points?.length ?? 0) - wins - losses;
  const winRate = points?.length ? (100 * wins / points.length).toFixed(1) + '%' : '—';

  return (
    <>
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
          change="From verified closed trades"
          icon={ShieldCheck}
          positive={!!points?.length && points.reduce((sum, point) => sum + point.value, 0) >= 0}
        />
      </div>

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

        {analytics && points?.length > 0 && (
          <div className="trade-log">
          <h3>Closed trades</h3>
          <div className="trade-outcome-summary">
            <span data-outcome="Win">{wins} wins</span>
            <span data-outcome="Loss">{losses} losses</span>
            <span data-outcome="Break-even">{even} break-even</span>
          </div>
          <div className="tablewrap"><table>
            <thead>
              <tr><th>Transaction</th><th>Status</th><th>Realized P&L</th></tr>
            </thead>
            <tbody>
              {points.slice().reverse().map((t) => (
                <tr key={t.time}>
                  <td>{t.time}</td>
                  <td><span className="trade-outcome" data-outcome={t.status}>{t.status}</span></td>
                  <td data-outcome={t.status}>{t.value > 0 ? '+' : ''}{t.value.toFixed(2)} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table></div></div>
        )}
      </section>

      {!analytics && (
        <div className="panelhead">
          <button className="outline" onClick={() => navigate?.('Bot Agents')}>View Bot Agents</button>
        </div>
      )}
      {!analytics && id && <AccountActivity accountId={id} />}
    </>
  );
}