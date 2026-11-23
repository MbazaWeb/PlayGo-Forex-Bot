import { automaticEntryBlock } from '../../../shared/agent-analysis.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCandles } from './agentAnalysis.js';

function risingCandles() {
  return Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index * 0.12 + Math.sin(index * 1.1) * 0.5;
    return {
      epoch: 1_700_000_000 + index * 60,
      open: close - 0.1,
      high: close + 0.2,
      low: close - 0.2,
      close,
    };
  });
}

test('requires a minimum amount of verified candle data', () => {
  assert.equal(analyzeCandles(risingCandles().slice(0, 49), 60).status, 'insufficient');
});

test('produces a thresholded confluence signal without calling it a win probability', () => {
  const result = analyzeCandles(risingCandles(), 60);
  assert.equal(result.status, 'ready');
  assert.equal(result.direction, 'bullish');
  assert.ok(result.confluenceScore >= 75);
  assert.ok(result.volatilityPct >= 0);
  assert.equal(result.reviewAt, result.last.epoch + 60);
});

test('rejects malformed candle values', () => {
  const candles = risingCandles();
  candles[79] = { ...candles[79], close: Number.NaN };
  assert.equal(analyzeCandles(candles, 60).status, 'invalid');
});

test('automatic entries require a stronger signal and pass the volatility check', () => {
  const analysis = { status: 'ready', direction: 'bullish', confluenceScore: 85, volatilityRank: 0.8 };
  assert.equal(automaticEntryBlock(analysis), null);
  assert.equal(automaticEntryBlock({ ...analysis, confluenceScore: 75 }), 'WEAK_SIGNAL');
  assert.equal(automaticEntryBlock({ ...analysis, volatilityRank: 0.81 }), 'ELEVATED_VOLATILITY');
  assert.equal(automaticEntryBlock({ ...analysis, direction: null }), 'WEAK_SIGNAL');
});
