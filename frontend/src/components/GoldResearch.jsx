import React, { useEffect, useState } from 'react';
import { goldSignals, GOLD_SIGNAL_BARS } from '../../../shared/gold-bollinger.js';
import { closedMarketBars, marketIntegrityBlock } from '../../../shared/market-review.js';
import { publicRequest } from './derivMarkets';
import { simpleBotStatus } from './brokerRequest';

const interval = 900;
const signalLabel = signal => signal > 0 ? 'Buy setup' : signal < 0 ? 'Sell setup' : 'No entry';

export default function GoldResearch({ market, catalogLoading }) {
  const [result, setResult] = useState(null);
  const symbol = market?.symbol;
  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const response = await publicRequest({ ticks_history: symbol, style: 'candles', end: 'latest', count: GOLD_SIGNAL_BARS + 1, granularity: interval }, controller.signal);
        if (controller.signal.aborted) return;
        const now = Date.now();
        const bars = closedMarketBars(response.candles, interval, now).slice(-GOLD_SIGNAL_BARS);
        const block = marketIntegrityBlock(bars, interval, now, GOLD_SIGNAL_BARS);
        const signal = block ? null : goldSignals(bars.map(bar => bar.close));
        setResult({ symbol, signal, block, closeAt: bars.at(-1)?.epoch + interval });
      } catch {
        if (!controller.signal.aborted) setResult({ symbol, block: 'Gold candles unavailable' });
      } finally {
        if (!controller.signal.aborted) {
          const intervalMs = interval * 1000;
          timer = setTimeout(refresh, intervalMs - Date.now() % intervalMs + 2000);
        }
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [symbol]);

  const current = result?.symbol === symbol ? result : null;
  const signal = current?.signal;
  return (
    <section className="panel" aria-label="Gold Double Bollinger Bands">
      <div className="panelhead"><div><h2>Gold Double Bollinger Bands</h2><p>XAU/USD · M15 · Signal research</p></div></div>
      {!market ? <p role="status">{catalogLoading ? 'Checking market availability.' : 'Gold is unavailable in the market feed.'}</p>
        : !signal ? <p role="status">{current?.block === 'INSUFFICIENT' ? 'Waiting for 21 closed Gold candles.' : current?.block ? simpleBotStatus(current.block) : current ? 'Invalid candle prices.' : 'Checking closed candles.'}</p>
        : <div aria-live="polite">
          <dl className="agent-setup-summary">
            <div><dt>Trend</dt><dd>{signalLabel(signal.trend)}</dd></div>
            <div><dt>Mean reversion</dt><dd>{signalLabel(signal.reversion)}</dd></div>
            <div><dt>SMA 20</dt><dd>{signal.bands.average.toFixed(2)}</dd></div>
            <div><dt>Last candle closed (EAT)</dt><dd>{new Date(current.closeAt * 1000).toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })}</dd></div>
          </dl>
          <details><summary>Strategy rules</summary>
            <p>Trend crosses the inner band and exits on return to the SMA. Mean reversion re-enters through the outer band and exits at the SMA or on a renewed outer-band break.</p>
          </details>
        </div>}
    </section>
  );
}
