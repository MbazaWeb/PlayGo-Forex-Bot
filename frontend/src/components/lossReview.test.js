import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLoss } from './lossReview.js';

test('distinguishes an adverse expiry from a confirmed early sale', () => {
  const trade = { buy: 10, sell: 0, review: { direction: 'CALL', entrySpot: 12, exitSpot: 10, status: 'lost' } };
  assert.match(reviewLoss(trade).observed, /opposed the Rise entry/);
  const exit = reviewLoss(trade, null, { reason: 'Stop-loss triggered' });
  assert.match(exit.observed, /Stop-loss triggered/);
  assert.doesNotMatch(exit.observed, /opposed/);
});

test('reports missing evidence on unattributed historical losses', () => {
  const review = reviewLoss({ buy: 100, sell: 0 });
  assert.match(review.observed, /Loss: 100/);
  assert.match(review.gaps, /Strategy unavailable/);
  assert.match(review.gaps, /Exit reason unavailable/);
  assert.doesNotMatch(review.observed, /price|expiry|stop-loss/i);
});
