import React, { useEffect, useMemo, useState } from 'react';
import MarketChart from './MarketChart';
import { publicRequest, readCandles, readMarkets } from './derivMarkets';

const CATALOG_PAYLOAD = Object.freeze({ active_symbols: 'brief' });

function useRequest(key, payload, parse, context) {
  const [result, setResult] = useState({});
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!key || payload == null) return;
    const controller = new AbortController();
    publicRequest(payload, controller.signal)
      .then(parse)
      .then((rows) => {
        if (!controller.signal.aborted) setResult({ key, attempt, rows });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('[Deriv market data] request failed', {
            context,
            error: error?.message || 'Unknown error',
          });
          setResult({ key, attempt, error: true });
        }
      });
    return () => controller.abort();
  }, [key, payload, parse, context, attempt]);
  return [
    result.key === key && result.attempt === attempt ? result : {},
    () => retry((n) => n + 1),
  ];
}

export function useMarketList(initialSymbol) {
  const [result, retry] = useRequest(
    'catalog',
    CATALOG_PAYLOAD,
    readMarkets,
    'market catalog',
  );
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

function PriceBars({ data, type }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <p role="status">No candles.</p>;
  }
  const low = Math.min(...data.map((d) => d.low));
  const high = Math.max(...data.map((d) => d.high));
  const y = (v) => (high === low ? 140 : 265 - ((v - low) / (high - low)) * 250);
  const step = 640 / data.length;
  const half = Math.min(4, step * 0.35);

  return (
    <svg role="img" aria-label={type + ' price chart in UTC'} viewBox="0 0 738 300" width="100%">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1="0" x2="640" y1={15 + 250 * f} y2={15 + 250 * f} stroke="#334155" />
          <text x="646" y={19 + 250 * f} fill="#aab7ca" fontSize="11">
            {+(high - (high - low) * f).toPrecision(7)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = (i + 0.5) * step;
        const color = d.close >= d.open ? '#45d5c5' : '#ff8492';
        return (
          <g key={d.epoch} stroke={color}>
            <title>
              {d.time} UTC · Open {d.open} · High {d.high} · Low {d.low} · Close {d.close}
            </title>
            <line x1={x} x2={x} y1={y(d.high)} y2={y(d.low)} />
            {type === 'Candlestick' ? (
              <rect
                x={x - half}
                width={half * 2}
                y={Math.min(y(d.open), y(d.close))}
                height={Math.max(1, Math.abs(y(d.open) - y(d.close)))}
                fill={color}
              />
            ) : (
              <path d={`M${x - half} ${y(d.open)}h${half} M${x} ${y(d.close)}h${half}`} />
            )}
          </g>
        );
      })}
      <text x="0" y="290" fill="#aab7ca">{data[0].time}</text>
      <text x="640" y="290" textAnchor="end" fill="#aab7ca">
        {data[data.length - 1].time} UTC
      </text>
    </svg>
  );
}

export default function MarketExplorer({ catalog, overview }) {
  const [type, setType] = useState(overview ? 'Area' : 'Candlestick');
  const [interval, setInterval] = useState(3600);
  const { market, result } = catalog;

  const payload = useMemo(
    () => market
      ? {
        ticks_history: market.symbol,
        style: 'candles',
        end: 'latest',
        adjust_start_time: 1,
        count: 72,
        granularity: interval,
      }
      : null,
    [market?.symbol, interval],
  );

  const [history, reload] = useRequest(
    market ? market.symbol + '/' + interval : '',
    payload,
    readCandles,
    market ? `${market.symbol} ${interval}s candle history` : 'candle history',
  );
  const data = history.rows;

  function chartOptions() {
    return (
      <>
        <label>
          Chart type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {['Candlestick', 'OHLC bars', 'Line', 'Area'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Interval
          <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
            {[
              [60, '1 minute'], [300, '5 minutes'], [900, '15 minutes'],
              [3600, '1 hour'], [14400, '4 hours'], [86400, '1 day'],
            ].map(([n, t]) => (
              <option key={n} value={n}>{t}</option>
            ))}
          </select>
        </label>
      </>
    );
  }

  return (
    <section className="panel chart-panel">
      <div className="panelhead">
        <div>
          <h2>{overview ? 'Market Overview' : 'Market Chart'}</h2>
          {overview && <p>Deriv Options · Historical prices</p>}
        </div>
      </div>

      <div className={overview ? 'market-controls' : 'terminal-market-controls'}>
        <label>
          Market
          <InstrumentSelect catalog={catalog} />
        </label>
        {overview ? (
          chartOptions()
        ) : (
          <details className="terminal-chart-options">
            <summary>Chart settings</summary>
            <div className="market-controls">{chartOptions()}</div>
          </details>
        )}
      </div>

      {data?.length > 0 ? (
        <>
          <div className="market-line">
            <div>
              <b>{market.name}</b>
              <small>{data[data.length - 1].time} UTC · Last candle</small>
            </div>
            <strong>{data[data.length - 1].close}</strong>
          </div>
          {['Line', 'Area'].includes(type) ? (
            <MarketChart
              data={data}
              line={type === 'Line'}
              label="Close"
              tall={!overview}
            />
          ) : (
            <PriceBars data={data} type={type} />
          )}
          <button className="textlink" onClick={reload}>Refresh prices</button>
        </>
      ) : (
        <p role="status">
          {!market
            ? result.error
              ? 'Market catalog unavailable.'
              : result.rows
                ? 'No markets returned.'
                : 'Loading markets…'
            : history.error
              ? 'Price history unavailable.'
              : data
                ? 'No candles returned.'
                : 'Loading history…'}{' '}
          {((!market && (result.error || result.rows)) ||
            (market && (history.error || data))) && (
            <button onClick={market ? reload : catalog.retry}>Retry</button>
          )}
        </p>
      )}
    </section>
  );
}