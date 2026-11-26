import assert from 'node:assert/strict';
import test from 'node:test';
import { marketIntegrityBlock } from '../../trading/market-data.js';

test('checks freshness, alignment, duplicate timestamps and gaps in recent candles', () => {
  const granularity = 300;
  const current = 1_800_000_000;
  const now = current * 1000;
  const good = Array.from({ length: 50 }, (_, index) => ({ epoch: current - (50 - index) * granularity }));
  const replace = (index, epoch) => good.map((row, at) => at === index ? { epoch } : row);
  assert.equal(marketIntegrityBlock(good, granularity, now), null);
  assert.equal(marketIntegrityBlock(good.slice(1), granularity, now), 'INSUFFICIENT');
  assert.equal(marketIntegrityBlock(good, granularity, now + 600_000), 'STALE_MARKET_DATA');
  assert.equal(marketIntegrityBlock(replace(10, good[10].epoch + 1), granularity, now), 'MARKET_DATA_GAP');
  assert.equal(marketIntegrityBlock(replace(10, good[9].epoch), granularity, now), 'DUPLICATE_MARKET_DATA');
  assert.equal(marketIntegrityBlock(replace(0, good[0].epoch - granularity), granularity, now), 'MARKET_DATA_GAP');
});
