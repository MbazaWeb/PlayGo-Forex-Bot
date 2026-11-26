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

test('complete five-minute candles with a consistent broker offset can be analyzed', () => {
  const fiveMinuteBars = Array.from({ length: 50 }, (_, index) => ({
    epoch: start - (50 - index) * 300 + 3,
    open: 100, high: 101, low: 99, close: 100,
  }));
  assert.equal(reviewMarket(fiveMinuteBars, 300, now + 4000, true).block, 'WEAK_SIGNAL');
  assert.equal(reviewMarket(fiveMinuteBars, 300, now + 1000, true).block, 'UNALIGNED_MARKET_DATA');
  const malformed = [...fiveMinuteBars];
  malformed[10] = { ...malformed[10], epoch: malformed[10].epoch + 1 };
  assert.equal(reviewMarket(malformed, 300, now + 4000, true).block, 'MARKET_DATA_GAP');
  assert.equal(reviewMarket(null, 300, now, true).block, 'INVALID');
  const closed = closedMarketBars([...fiveMinuteBars, { ...fiveMinuteBars.at(-1), epoch: start + 3 }], 300, now + 4000);
  assert.deepEqual(closed, fiveMinuteBars);
});

test('an old session gap does not block 60 consecutive recent candles', () => {
  const previousSession = bars.slice(0, 20).map(bar => ({ ...bar, epoch: bar.epoch - 86400 }));
  assert.equal(reviewMarket([...previousSession, ...bars], 60, now, true).block, 'WEAK_SIGNAL');
  const brokenRecent = [...bars];
  brokenRecent[10] = { ...brokenRecent[10], epoch: brokenRecent[10].epoch + 1 };
  assert.equal(reviewMarket([...previousSession, ...brokenRecent], 60, now, true).block, 'MARKET_DATA_GAP');
});
