import test from 'node:test';
import assert from 'node:assert/strict';
import { bollingerBands, goldSignals, goldExit } from './gold-bollinger.js';

test('Gold trend detects fresh inner-band crossings in either direction', () => {
  const flat = Array(20).fill(2400);
  assert.equal(goldSignals([...flat, 2410]).trend, 1);
  assert.equal(goldSignals([...flat, 2390]).trend, -1);
  assert.equal(goldSignals([...flat, 2410, 2411]).trend, 0);
});

test('Gold mean reversion waits for an outer-band re-entry and has two exits', () => {
  const flat = Array(20).fill(2400);
  assert.equal(goldSignals([...flat, 2390]).reversion, 0);
  assert.equal(goldSignals([...flat, 2390, 2398]).reversion, 1);
  assert.equal(goldSignals([...flat, 2410, 2402]).reversion, -1);
  assert.equal(goldExit('reversion', 1, -1), false);
  assert.equal(goldExit('reversion', 1, -2), true);
  assert.equal(goldExit('reversion', -1, 0), true);
  assert.equal(bollingerBands([...flat, NaN]), null);
});
