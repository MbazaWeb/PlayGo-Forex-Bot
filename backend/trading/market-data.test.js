import assert from 'node:assert/strict';
import test from 'node:test';
import { readMarketCandles } from './market-data.js';

const now = 1_800_000_000_000;

test('reads Deriv candles with string prices and removes only the unfinished interval', async () => {
  const candles = Array.from({ length: 60 }, (_, index) => {
    const epoch = now / 1000 - (60 - index) * 300;
    return {
      epoch: String(epoch),
      open: '100.00',
      high: '101.00',
      low: '99.00',
      close: '100.50',
    };
  });
  candles.push({
    epoch: String(now / 1000),
    open: '100.50',
    high: '102.00',
    low: '100.00',
    close: '101.50',
  });

  class CandleSocket {
    constructor() {
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }

    send(raw) {
      const request = JSON.parse(raw);
      assert.deepEqual(request, {
        ticks_history: 'R_75',
        style: 'candles',
        end: 'latest',
        count: 200,
        granularity: 300,
        req_id: 1,
      });
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify({ req_id: 1, candles }),
      }));
    }

    close() {
      this.readyState = 3;
    }
  }

  const result = await readMarketCandles({
    symbol: 'R_75',
    granularity: 300,
    Socket: CandleSocket,
    now: () => now,
  });
  assert.equal(result.length, 60);
  assert.ok(result.every(row => Number.isInteger(row.epoch) && row.close === 100.5));
});

test('a candle request timeout is surfaced as a market-data timeout', async () => {
  class SilentSocket {
    constructor() {
      this.readyState = 1;
    }

    send() {}
    close() {}
  }

  await assert.rejects(readMarketCandles({
    symbol: 'R_75',
    granularity: 60,
    Socket: SilentSocket,
    timeoutMs: 1,
  }), /MARKET_DATA_TIMEOUT/);
});
