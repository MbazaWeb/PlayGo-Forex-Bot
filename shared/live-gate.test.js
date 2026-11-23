import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLiveGate, breakEvenWinRate, eatWeekKey } from './live-gate.js';

const DAY = 86400;
// Build n trades spread over `weeks` weeks, with `winRate` share of wins.
function synthetic(n, weeks, winRate, win = 7.5, loss = 10) {
  const base = Date.UTC(2026, 10, 2, 9) / 1000; // Mon 2 Nov 2026 09:00 UTC
  const trades = [];
  for (let i = 0; i < n; i++) {
    const week = i % weeks;
    const settledAt = base + week * 7 * DAY + Math.floor(i / weeks) * 3600;
    const won = (i % 100) < winRate * 100;
    trades.push({ settledAt, buy: 10, sell: won ? 10 + win : 0, strategy: 'Trend + momentum', reconciled: true });
  }
  return trades;
}

test('break-even win rate matches the payout structure', () => {
  assert.ok(Math.abs(breakEvenWinRate(7.36, 10) - 0.5761) < 0.001);
  assert.equal(breakEvenWinRate(null, 10), null);
});

test('EAT weeks start on Monday', () => {
  const sunday = Date.UTC(2026, 10, 1, 21) / 1000; // Sun 1 Nov 21:00 UTC = Mon 2 Nov 00:00 EAT
  assert.equal(eatWeekKey(sunday), '2026-11-02');
  assert.equal(eatWeekKey(sunday - 3600), '2026-10-26');
});

test('25 trades in one session fail the gate', () => {
  const result = evaluateLiveGate(synthetic(25, 1, 0.56));
  assert.equal(result.passed, false);
  assert.equal(result.checks.find(c => c.id === 'sample').passed, false);
  assert.equal(result.checks.find(c => c.id === 'weeks').passed, false);
});

test('500 profitable trades over 3+ weeks pass the gate', () => {
  const result = evaluateLiveGate(synthetic(500, 4, 0.65));
  assert.equal(result.checks.find(c => c.id === 'sample').passed, true);
  assert.equal(result.checks.find(c => c.id === 'weeks').passed, true);
  assert.equal(result.checks.find(c => c.id === 'net').passed, true);
  assert.equal(result.passed, true);
});

test('500 trades at break-even do not pass', () => {
  const result = evaluateLiveGate(synthetic(500, 4, 0.5));
  assert.equal(result.passed, false);
});

test('unreconciled or unlabelled trades block the gate', () => {
  const trades = synthetic(500, 4, 0.65);
  trades[10].reconciled = false;
  trades[20].strategy = null;
  const result = evaluateLiveGate(trades);
  assert.equal(result.checks.find(c => c.id === 'reconciled').passed, false);
  assert.equal(result.checks.find(c => c.id === 'strategy').passed, false);
  assert.equal(result.passed, false);
});

test('a short out-of-sample window cannot pass on its own', () => {
  const result = evaluateLiveGate(synthetic(25, 1, 0.9));
  assert.equal(result.checks.find(c => c.id === 'outOfSample').passed, false);
});
