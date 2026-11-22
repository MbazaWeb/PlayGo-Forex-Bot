import React, { useEffect, useState } from 'react';
import { publicRequest, readCandles } from '../derivMarkets';
import { packSignal } from '../../../../backend/trading/pack/signal.js';

const CANDLE_COUNT = 400;

export default function StrategyReplay({ strategy, fast, slow }) {
  const [run, setRun] = useState(0);
  const [result, setResult] = useState('');

  useEffect(() => {
    setResult('');
    if (!run) return;

    const ctrl = new AbortController();
    const end = Math.floor(Date.now() / 60000) * 60 - 1;
    setResult('Loading EUR/USD history...');

    async function replay() {
      const response = await publicRequest(
        {
          ticks_history: 'frxEURUSD',
          style: 'candles',
          granularity: 60,
          count: CANDLE_COUNT,
          end: String(end),
          adjust_start_time: 1,
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      const rows = readCandles(response).filter((r) => r.epoch + 60 <= end + 1);
      if (!rows.length) {
        setResult('No historical candles returned.');
        return;
      }

      const windowSize = Math.max(slow * 2, 40) + 5;
      if (rows.length <= windowSize) {
        setResult('Insufficient consecutive closed candles for replay.');
        return;
      }

      let trades = 0;
      let pnl = 0;
      let eligible = 0;
      const daily = new Map();

      for (let i = windowSize; i < rows.length; i++) {
        const next = rows[i];
        const previous = rows[i - 1];
        if (!next || !previous) continue;
        if (next.epoch !== previous.epoch + 60) continue;

        let signal;
        try {
          ({ signal } = packSignal(
            rows.slice(i - windowSize, i),
            { pack_id: strategy, fast, slow },
            next.epoch,
          ));
        } catch {
          continue;
        }
        if (!signal || signal === 'unavailable') continue;
        eligible++;

        const day = Math.floor((next.epoch + 60) / 86400);
        if (!['up', 'down'].includes(signal)) continue;
        if ((daily.get(day) || 0) <= -200) continue;
        if (next.open > 10 || next.close > 10) continue;

        const gain = (signal === 'up' ? 1 : -1) * (next.close - next.open) * 100;
        if (!Number.isFinite(gain)) continue;
        trades++;
        pnl += gain;
        daily.set(day, (daily.get(day) || 0) + gain);
      }

      if (ctrl.signal.aborted) return;
      const last = rows[rows.length - 1];
      setResult(
        eligible
          ? `${eligible} eligible bars - ${trades} simulated fills - ${pnl.toFixed(2)} USD - through ${last.time} UTC`
          : 'Insufficient consecutive closed candles for replay.',
      );
    }

    replay().catch((err) => {
      if (ctrl.signal.aborted) return;
      setResult(
        err?.message === 'Cancelled'
          ? 'Replay cancelled.'
          : 'Historical candles unavailable. Retry the replay.',
      );
    });

    return () => ctrl.abort();
  }, [run, strategy, fast, slow]);

  return (
    <div>
      <button className="outline" onClick={() => setRun((n) => n + 1)}>
        Replay strategy on recent candles
      </button>
      <p role="status">{result}</p>
    </div>
  );
}