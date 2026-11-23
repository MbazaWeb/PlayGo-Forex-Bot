import React, { useEffect, useMemo, useState } from 'react';
import ProChart from './ProChart';
import { publicRequest, readCandles, readMarkets } from './derivMarkets';

const CATALOG_REQUEST = { active_symbols: 'brief' };

function useRequest(key, payload, parse) {
  const [result, setResult] = useState({});
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!key || payload == null) return;
    const controller = new AbortController();
    publicRequest(payload, controller.signal)
      .then(parse)
      .then((rows) => { if (!controller.signal.aborted) setResult({ key, attempt, rows }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, attempt, error: true }); });
    return () => controller.abort();
  }, [key, payload, parse, attempt]);
  return [result.key === key && result.attempt === attempt ? result : {}, () => retry((n) => n + 1)];
}

export function useMarketList(initialSymbol) {
  const [result, retry] = useRequest('catalog', CATALOG_REQUEST, readMarkets);
  const [symbol, setSymbol] = useState(initialSymbol || 'R_75');
  const rows = result.rows || [];
  const market = rows.find((row) => row.symbol === symbol) || rows[0] || null;
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
      disabled={!catalog.market}
      value={catalog.market?.symbol || ''}
      onChange={(e) => catalog.setSymbol(e.target.value)}
    >
      {!catalog.market && <option value="">Select market</option>}
      {[...groups].map(([group, rows]) => (
        <optgroup key={group} label={group}>
          {rows.map((row) => (
            <option key={row.symbol} value={row.symbol}>
              {row.name} ({row.symbol})
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
  const { market, result } = catalog;

  const symbol = market?.symbol;
  const payload = useMemo(() => symbol ? {
    ticks_history: symbol, style: 'candles', end: 'latest',
    adjust_start_time: 1, count: 200, granularity: interval,
  } : null, [symbol, interval]);

  const [history, reload] = useRequest(market ? market.symbol + '/' + interval : '', payload, readCandles);
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
        <div><h2>{overview ? 'Market Overview' : 'Market Chart'}</h2>{overview && <p>Deriv Options - Live prices</p>}</div>
      </div>

      <div className={overview ? 'market-controls' : 'terminal-market-controls'}>
        <label>Market<InstrumentSelect catalog={catalog} /></label>
        {overview ? chartOptions() : (
          <details className="terminal-chart-options">
            <summary>Chart settings</summary>
            <div className="market-controls">{chartOptions()}</div>
          </details>
        )}
      </div>

      {data?.length > 0 ? (
        <>
          <div className="market-line">
            <div><b>{market.name}</b><small>{data[data.length - 1].time} UTC</small></div>
            <strong>{data[data.length - 1].close}</strong>
          </div>

          <div style={{ marginTop: '16px' }}>
            <ProChart data={data} type={type} height={overview ? 300 : 500} />
          </div>

          <button className="textlink" style={{ marginTop: '16px' }} onClick={reload}>Refresh prices</button>
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