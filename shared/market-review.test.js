import test from 'node:test';
import assert from 'node:assert/strict';
import { closedMarketBars, reviewMarket, marketReviewReceipt } from './market-review.js';

const now = 1_800_000_000_000;
const start = now / 1000;
const bars = Array.from({ length: 60 }, (_, index) => ({
  epoch: start - (60 - index) * 60, open: 100, high: 101, low: 99, close: 100,
}));

test('preview and entry checks ignore the unfinished bar and hold a weak setup', () => {
  const closed = closedMarketBars([...bars, { epoch: start, close: 900 }], 60, now);
  assert.deepEqual(closed, bars);
  const review = reviewMarket(closed, 60, now, true);
  assert.equal(review.bars, 60);
  assert.equal(review.block, 'WEAK_SIGNAL');
});

test('all signal-driven entry modes hold stale, duplicate and malformed market data', () => {
  for (const automatic of [false, true]) {
    assert.equal(reviewMarket(bars, 60, now + 180000, automatic).block, 'STALE_MARKET_DATA');
    assert.equal(reviewMarket([...bars, bars.at(-1)], 60, now, automatic).block, 'DUPLICATE_MARKET_DATA');
    const broken = [...bars.slice(0, -1), { ...bars.at(-1), high: 95 }];
    assert.equal(reviewMarket(broken, 60, now, automatic).block, 'INVALID');
  }
});

test('receipts distinguish a skipped setup from unverified candle history', () => {
  const held = marketReviewReceipt(reviewMarket(bars, 60, now, true));
  assert.equal(held.closedAt, start);
  assert.equal(held.block, 'WEAK_SIGNAL');
  const gap = [...bars];
  gap[1] = { ...gap[1], epoch: gap[0].epoch };
  const blocked = marketReviewReceipt(reviewMarket(gap, 60, now, true));
  assert.equal(blocked.closedAt, null);
  assert.equal(blocked.block, 'DUPLICATE_MARKET_DATA');
  assert.equal(marketReviewReceipt(null), null);
});
