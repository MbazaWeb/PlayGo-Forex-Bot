import assert from 'node:assert/strict';
import test from 'node:test';
import { consecutiveLossHalt, dailyRiskState, startOfEatDay, MAX_OPEN_CONTRACTS } from './execution-risk.js';

const row = (sell, settledAt) => ({ buy: 10, sell, settledAt });
const NOW = Date.UTC(2026, 10, 24, 12) / 1000; // 24 Nov 2026 12:00 UTC = 15:00 EAT

test('open-contract limit matches the documented five', () => {
  assert.equal(MAX_OPEN_CONTRACTS, 5);
});

test('three losses in a row inside the cooldown halt the bot', () => {
  const rows = [row(0, NOW - 60), row(0, NOW - 120), row(0, NOW - 180), row(15, NOW - 240)];
  assert.equal(consecutiveLossHalt(rows, NOW), true);
});

test('the same streak stops halting once the cooldown has passed', () => {
  const rows = [row(0, NOW - 3600), row(0, NOW - 3700), row(0, NOW - 3800)];
  assert.equal(consecutiveLossHalt(rows, NOW), false);
});

test('a win breaks the streak', () => {
  const rows = [row(0, NOW - 60), row(12, NOW - 120), row(0, NOW - 180), row(0, NOW - 240)];
  assert.equal(consecutiveLossHalt(rows, NOW), false);
});

test('daily loss cap breaches at 5% of starting balance and is fail-closed when history may be truncated', () => {
  const dayStart = startOfEatDay(NOW);
  const losses = [row(0, dayStart + 100), row(0, dayStart + 200), row(0, dayStart + 300)];
  const breach = dailyRiskState(losses, { nowEpoch: NOW, fetchLimit: 50, startingBalance: 500 });
  assert.equal(breach.complete, true);
  assert.equal(breach.breached, true);
  // Full page of today's rows: we cannot see the start of the day, so the state is incomplete.
  const full = Array.from({ length: 50 }, (_, i) => row(10, dayStart + 1000 + i));
  const truncated = dailyRiskState(full, { nowEpoch: NOW, fetchLimit: 50, startingBalance: 500 });
  assert.equal(truncated.complete, false);
  assert.equal(truncated.breached, false);
});

test('paged daily history counts losses beyond the recent page and blocks a capped result', () => {
  const rows = Array.from({ length: 75 }, (_, i) => row(i < 25 ? 8 : 10, NOW - i));
  const options = { nowEpoch: NOW, startingBalance: 500 };
  assert.deepEqual(dailyRiskState(rows, { ...options, historyComplete: true }),
    { complete: true, todayNet: -50, breached: true });
  assert.equal(dailyRiskState(rows, { ...options, historyComplete: false }).complete, false);
});
