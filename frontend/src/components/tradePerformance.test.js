import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeClosedTrades } from './tradePerformance.js';

test('calculates performance in settlement order with a zero starting peak', () => {
  assert.deepEqual(summarizeClosedTrades([-10, 30, -15, -20].map(value => ({ value }))), {
    net: -15, average: -3.75, profitFactor: 30 / 45, drawdown: 35,
  });
  assert.equal(summarizeClosedTrades([{ value: -4 }]).drawdown, 4);
  assert.equal(summarizeClosedTrades([{ value: 8 }]).profitFactor, null);
  assert.equal(summarizeClosedTrades([]).average, null);
});
