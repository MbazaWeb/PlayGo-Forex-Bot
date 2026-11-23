import test from 'node:test';
import assert from 'node:assert/strict';
import { publicRequest, readMarkets, readCandles } from './derivMarkets.js';

test('waits for a connecting WebSocket to open before closing after cancellation', async (t) => {
  const originalWebSocket = globalThis.WebSocket;
  t.after(() => { globalThis.WebSocket = originalWebSocket; });

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances = [];

    constructor() {
      this.readyState = MockWebSocket.CONNECTING;
      this.closeCalls = 0;
      MockWebSocket.instances.push(this);
    }

    close() {
      this.closeCalls += 1;
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code: 1000 });
    }

    open() {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }
  }

  globalThis.WebSocket = MockWebSocket;
  const controller = new AbortController();
  const request = publicRequest({ active_symbols: 'brief' }, controller.signal);
  controller.abort();

  await assert.rejects(request, /Cancelled/);
  const socket = MockWebSocket.instances[0];
  assert.equal(socket.closeCalls, 0);

  socket.open();
  assert.equal(socket.closeCalls, 1);
});

test('keeps unfamiliar market groups and deduplicates symbols', () => {
  const row = { underlying_symbol: 'X', underlying_symbol_name: 'Example', market: 'new_market' };
  assert.deepEqual(readMarkets({ active_symbols: [row, row, {}] }), [
    { symbol: 'X', name: 'Example', group: 'new market' },
  ]);
});

test('handles missing/invalid market payloads', () => {
  assert.deepEqual(readMarkets(null), []);
  assert.deepEqual(readMarkets({}), []);
  assert.deepEqual(readMarkets({ active_symbols: 'nope' }), []);
});

test('uses broker OHLC and rejects inconsistent candles', () => {
  const candle = { epoch: '1720000000', open: '5', high: '8', low: '4', close: '7' };
  const rows = readCandles({
    candles: [candle, { ...candle, low: '6' }, { ...candle, high: null }],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].open, rows[0].high, rows[0].low, rows[0].value],
    [5, 8, 4, 7],
  );
});

test('rejects out-of-range, zero, and negative candles', () => {
  const bad = [
    { epoch: '0', open: '1', high: '2', low: '0.5', close: '1.5' },
    { epoch: '999999999', open: '1', high: '2', low: '0.5', close: '1.5' },
    { epoch: '1720000000', open: '-1', high: '2', low: '0.5', close: '1.5' },
    { epoch: '1720000000', open: '1', high: '0', low: '-1', close: '0' },
  ];
  assert.equal(readCandles({ candles: bad }).length, 0);
});

test('deduplicates by epoch and sorts ascending', () => {
  const a = { epoch: '1720000120', open: '1', high: '2', low: '0.5', close: '1.5' };
  const b = { epoch: '1720000060', open: '1', high: '2', low: '0.5', close: '1.5' };
  const rows = readCandles({ candles: [a, b, a] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.epoch), [1720000060, 1720000120]);
});

test('returns empty for null payload', () => {
  assert.deepEqual(readCandles(null), []);
  assert.deepEqual(readCandles({}), []);
});