import test from 'node:test';
import assert from 'node:assert/strict';
import { retryRead } from './derivMarkets.js';

test('retries failed public reads with bounded exponential delays', async () => {
  let attempts = 0;
  const delays = [];
  const result = await retryRead(
    async () => {
      attempts++;
      if (attempts < 3) throw new Error('temporary disconnect');
      return 'ok';
    },
    undefined,
    async (delay) => delays.push(delay),
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('does not retry a public read after cancellation', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(
    retryRead(
      async () => {
        attempts++;
        controller.abort();
        throw new Error('temporary disconnect');
      },
      controller.signal,
      async () => assert.fail('cancelled reads must not back off'),
    ),
    /temporary disconnect/,
  );
  assert.equal(attempts, 1);
});

test('cancelling during backoff clears the retry and stops further reads', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = retryRead(
    async () => {
      attempts++;
      throw new Error('temporary disconnect');
    },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /Cancelled/);
  assert.equal(attempts, 1);
});
