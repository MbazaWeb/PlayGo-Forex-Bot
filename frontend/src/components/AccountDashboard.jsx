import { brokerRequest } from './brokerRequest';
import { summarizeClosedTrades } from './tradePerformance';
import React, { useEffect, useState } from 'react';
import { Wallet, ShieldCheck, TrendingUp, TrendingDown, ListChecks } from 'lucide-react';
import Metric from './Metric';
import AccountActivity from './AccountActivity';
import { downloadTradePdf, downloadTradeReport } from './tradeReport';

const settlementFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Dar_es_Salaam', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const REPORT_PAGE_SIZE = 500;
const REPORT_MAX_ROWS = 10_000;
const MAX_REPORT_RANGE_SECONDS = 93 * 24 * 60 * 60;

const MarketChart = React.lazy(() => import('./MarketChart'));
const MarketWorkspace = React.lazy(() => import('./MarketWorkspace'));

export default function AccountDashboard({ accounts, mt5, navigate, marketSymbol, onMarketChange, analytics = false }) {
  const account = accounts?.[0];
  const id = account?.accountRef;
  const [history, setHistory] = useState(null);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNotice, setPdfNotice] = useState('');

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
        const res = await brokerRequest('/api/history', { signal: controller.signal });
        if (!res.ok) throw new Error('history unavailable');
        const body = await res.json();
        if (body?.accountRef !== id || !Array.isArray(body.transactions)) throw new Error('unexpected payload');
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

  async function exportReport(format = 'pdf') {
    setPdfBusy(true);
    setPdfNotice('');
    const ranged = Boolean(rangeFrom || rangeTo);
    const query = new URLSearchParams({ report: '1' });
    if (ranged) {
      const from = Date.parse(rangeFrom + 'T00:00:00+03:00') / 1000;
      const to = Math.min(Date.parse(rangeTo + 'T23:59:59+03:00') / 1000, Math.floor(Date.now() / 1000));
      if (!rangeFrom || !rangeTo || !Number.isFinite(from) || !Number.isFinite(to) || from > to) {
        setPdfNotice('Choose a valid start and end date in Tanzania time.');
        setPdfBusy(false);
        return;
      }
      if (to - from > MAX_REPORT_RANGE_SECONDS) {
        setPdfNotice('Choose a date range of 3 months or less.');
        setPdfBusy(false);
        return;
      }
      query.set('range', '1');
      query.set('from', String(from));
      query.set('to', String(to));
    }
    try {
      const transactions = [];
      const evidence = {};
      let evidenceAvailable = true;
      let failures = null;
      let failuresComplete = false;
      let serverLogs = null;
      let complete = !ranged;
      let partial = false;
      let offset = 0;
      do {
        const pageQuery = new URLSearchParams(query);
        pageQuery.set('offset', String(offset));
        pageQuery.set('limit', String(ranged ? Math.min(REPORT_PAGE_SIZE, Math.max(1, REPORT_MAX_ROWS - transactions.length)) : REPORT_MAX_ROWS));
        const response = await brokerRequest('/api/history?' + pageQuery);
        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error('The report service returned an invalid response.');
        }
        if (!response.ok) {
          throw new Error(data?.error || 'Report request failed (HTTP ' + response.status + ').');
        }
        if (data.accountRef !== id || !Array.isArray(data.transactions))
          throw new Error('The report service returned invalid trade data.');
        if (transactions.length + data.transactions.length > REPORT_MAX_ROWS) {
          partial = true;
          break;
        }
        transactions.push(...data.transactions);
        if (data.evidence && typeof data.evidence === 'object' && !Array.isArray(data.evidence))
          Object.assign(evidence, data.evidence);
        else evidenceAvailable = false;
        if (Array.isArray(data.failures)) {
          failures = data.failures;
          failuresComplete = data.failuresComplete === true;
        } else if (offset === 0) {
          failures = null;
          failuresComplete = false;
        }
        if (offset === 0)
          serverLogs = data.serverLogs && typeof data.serverLogs === 'object' && !Array.isArray(data.serverLogs)
            ? data.serverLogs : null;
        complete = !ranged || data.complete === true;
        const nextOffset = Number(data.nextOffset);
        if (ranged && (!Number.isSafeInteger(nextOffset) || (!complete && nextOffset <= offset)))
          throw new Error('The report service stopped before finishing this date range.');
        offset = nextOffset;
        if (transactions.length === REPORT_MAX_ROWS && !complete) {
          const probeQuery = new URLSearchParams(query);
          probeQuery.set('offset', String(offset));
          probeQuery.set('limit', '1');
          const probeResponse = await brokerRequest('/api/history?' + probeQuery);
          if (!probeResponse.ok) {
            partial = true;
            break;
          }
          const probe = await probeResponse.json();
          if (probe.accountRef !== id || !Array.isArray(probe.transactions))
            throw new Error('The report service returned invalid trade data.');
          if (probe.transactions.length) partial = true;
          else complete = true;
        }
      } while (ranged && !complete && !partial);

      const exportPoints = transactions.map(t => {
        const value = Number((t.sell - t.buy).toFixed(8));
        return { ...t, time: String(t.id), value, status: value > 0 ? 'Win' : value < 0 ? 'Loss' : 'Break-even' };
      });
      if (!exportPoints.length && !failures?.length && !serverLogs) {
        setPdfNotice('No settlements or diagnostic logs found for this report.');
        return;
      }
      const exportWins = exportPoints.filter(t => t.value > 0).length;
      const exportLosses = exportPoints.filter(t => t.value < 0).length;
      const report = { id, currency, points: exportPoints, performance: summarizeClosedTrades(exportPoints),
        wins: exportWins, losses: exportLosses, even: exportPoints.length - exportWins - exportLosses,
        settlementFormat, evidence: evidenceAvailable ? evidence : null, failures, failuresComplete,
        serverLogs, partial, requestedRange: ranged ? rangeFrom + ' to ' + rangeTo + ' EAT' : null };
      if (format === 'excel') downloadTradeReport(report);
      else downloadTradePdf(report);
      const warnings = [];
      if (partial) warnings.push('Partial report: 10,000-row cap reached. Narrow the date range for a complete export.');
      if (!evidenceAvailable) warnings.push('Some trade audit records were unavailable.');
      if (!failuresComplete) warnings.push('Technical failure records may be unavailable or incomplete.');
      if (!serverLogs?.complete)
        warnings.push(serverLogs?.note || 'Server runtime logs may be unavailable or incomplete.');
      setPdfNotice(warnings.join(' '));
    } catch (error) {
      setPdfNotice((format === 'excel' ? 'Excel' : 'PDF') + ' report could not be prepared: ' +
        (error instanceof Error ? error.message : 'unknown report error'));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <section aria-label="Today's trading results">
          <div className="panelhead"><div><h2>Today</h2><p>Settled trades · Tanzania time</p></div></div>
          <div className="metrics three">
            <Metric title="Today's Wins" value={today?.wins ?? '-'} icon={TrendingUp} positive />
            <Metric title="Today's Losses" value={today?.losses ?? '-'} icon={TrendingDown} positive={false} />
            <Metric title="Total Trades Today" value={today?.total ?? '-'} icon={ListChecks} />
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
            <div><h2>Profitability</h2><p>Selected account · {points?.length ?? 0} recent settled trades · includes bot and manual trades</p><p>Reports support date ranges up to 3 months.</p></div>
            <div className="analytics-report-actions">
            <button type="button" className="outline" disabled={!id || pdfBusy || (!points?.length && !rangeFrom && !rangeTo)}
              onClick={() => exportReport('excel')}>
              {pdfBusy ? "Preparing report…" : "Download Excel report"}
            </button>
            <label>From (EAT) <input type="date" value={rangeFrom} onChange={event => setRangeFrom(event.target.value)} /></label>
            <label>To (EAT) <input type="date" value={rangeTo} onChange={event => setRangeTo(event.target.value)} /></label>
            <button type="button" className="outline" disabled={!id || pdfBusy || (!points?.length && !rangeFrom && !rangeTo)}
              onClick={() => exportReport('pdf')}>
              {pdfBusy ? "Preparing PDF…" : "Download PDF report"}
            </button>
            </div>
          </div>
          {pdfNotice && <p role="status">{pdfNotice}</p>}
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
            <MarketChart data={points.slice().sort((a, b) => (a.settledAt || 0) - (b.settledAt || 0))} outcomes label={currency ? `P&L (${currency})` : 'P&L'} />
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
      {id && <AccountActivity key={id} accountRef={id} currency={currency} openAnalytics={analytics ? undefined : () => navigate('Analytics')} />}
    </>
  );
}