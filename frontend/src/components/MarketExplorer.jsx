import React, { useEffect, useMemo, useState } from 'react';
import ProChart from './ProChart';
import { publicRequest, readCandles, readMarkets } from './derivMarkets';

const CATALOG_REQUEST = { active_symbols: 'full' };
const STATUS_REFRESH_MS = 60_000;
const STATUS_MARKS = {
  Open: '\u{1F7E2}',
  Closed: '\u{1F534}',
  Suspended: '\u{1F7E1}',
  Unknown: '\u26AA',
};

function useRequest(key, payload, parse, refreshMs) {
  const [result, setResult] = useState({});
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!key || payload == null) return;
    const controller = new AbortController();
    let timer;
    async function update() {
      try {
        const rows = parse(await publicRequest(payload, controller.signal));
        if (!controller.signal.aborted) setResult({ key, attempt, rows, receivedAt: Date.now() });
      } catch {
        if (!controller.signal.aborted) setResult(previous => ({
          key, attempt, error: true,
          rows: previous.key !== key ? undefined : key === 'catalog'
            ? previous.rows?.map(row => ({ ...row, status: 'Unknown' })) : previous.rows,
          receivedAt: previous.key === key ? previous.receivedAt : undefined,
        }));
      } finally {
        if (refreshMs && !controller.signal.aborted) timer = setTimeout(update, refreshMs);
      }
    }
    void update();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, payload, parse, attempt, refreshMs]);
  return [result.key === key && result.attempt === attempt ? result : {}, () => retry((n) => n + 1)];
}

export function useMarketList(symbol, setSymbol) {
  const [result, retry] = useRequest('catalog', CATALOG_REQUEST, readMarkets, STATUS_REFRESH_MS);
  const rows = result.rows || [];
  const market = rows.find((row) => row.symbol === (symbol || 'R_75')) || (!symbol ? rows[0] : null) || null;
  return { market, rows, setSymbol, result, retry };
}

export function InstrumentSelect({ catalog }) {
  const groups = new Map();
  for (const row of catalog.rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  return (
    <select
      aria-label="Market"
      disabled={!catalog.rows.length}
      value={catalog.market?.symbol || ''}
      onChange={(e) => catalog.setSymbol(e.target.value)}
    >
      {!catalog.market && <option value="">{catalog.rows.length ? 'Choose an available market' : 'Select market'}</option>}
      {[...groups].map(([group, rows]) => (
        <optgroup key={group} label={group}>
          {rows.map((row) => (
            <option key={row.symbol} value={row.symbol}>
              {STATUS_MARKS[row.status]} {row.name} ({row.symbol}) - {row.status}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function MarketExplorer({ catalog, overview }) {
  const [type, setType] = useState(overview ? 'Area' : 'Candlestick');
  const [interval, setInterval] = useState(3600);
  const [showAverage, setShowAverage] = useState(false);
  const { market, result } = catalog;

  const symbol = market?.symbol;
  const payload = useMemo(() => symbol ? {
    ticks_history: symbol, style: 'candles', end: 'latest',
    adjust_start_time: 1, count: 200, granularity: interval,
  } : null, [symbol, interval]);

  const [history, reload] = useRequest(market ? market.symbol + '/' + interval : '', payload, readCandles, 30_000);
  const data = history.rows;

  function chartOptions() {
    return (
      <>
        <label>Chart type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {['Candlestick', 'Line', 'Area'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>Interval
          <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
            {[[60, '1 minute'], [300, '5 minutes'], [900, '15 minutes'], [3600, '1 hour'], [14400, '4 hours'], [86400, '1 day']].map(([n, t]) => <option key={n} value={n}>{t}</option>)}
          </select>
        </label>
      </>
    );
  }

  return (
    <section className="panel chart-panel">
      <div className="panelhead">
        <div><h2>{overview ? 'Market Overview' : 'Market Chart'}</h2><p>Deriv Options</p></div>
        {market && (
          <span className="market-status" data-status={market.status} role="status">
            {market.name} {market.status}
          </span>
        )}
      </div>

      <div className={overview ? 'market-controls' : 'terminal-market-controls'}>
        <label>Market<InstrumentSelect catalog={catalog} /></label>
        {overview ? chartOptions() : (
          <div className="market-controls">{chartOptions()}<button type="button" className="outline"
            aria-pressed={showAverage} onClick={() => setShowAverage(value => !value)}>SMA 20</button></div>
        )}
      </div>

      {data?.length > 0 ? (
        <>
          <div className="market-line">
            <div><b>{market.name}</b><small>Candle opened {data.at(-1).time} UTC</small></div>
            <strong>{data[data.length - 1].close}</strong>
          </div>

          <div style={{ marginTop: '16px' }}>
            <ProChart key={symbol + interval} data={data} type={type} height={overview ? 300 : 460} showAverage={showAverage} tools={!overview} />
          </div>

          <div className="chart-footer"><small role="status">{history.error ? 'Refresh failed · showing last prices' : 'Updates every 30s'} · {new Date(history.receivedAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })} EAT</small>
            <button type="button" className="textlink" onClick={reload}>Refresh prices</button></div>
        </>
      ) : (
        <p role="status">
          {!market ? (result.error ? 'Market catalog unavailable.' : result.rows ? 'No markets returned.' : 'Loading markets...')
            : history.error ? 'Price history unavailable.' : data ? 'No candles returned.' : 'Loading history...'}{' '}
          {((!market && (result.error || result.rows)) || (market && (history.error || data))) && <button onClick={market ? reload : catalog.retry}>Retry</button>}
        </p>
      )}
    </section>
  );
}