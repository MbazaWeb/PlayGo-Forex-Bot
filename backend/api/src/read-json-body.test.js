import assert from 'node:assert/strict';
import test from 'node:test';
import { readJsonBody } from './read-json-body.js';

test('reads JSON strings and rejects oversized request bodies', async () => {
  assert.deepEqual(await readJsonBody({ body: '{"entries":[]}' }), { entries: [] });
  await assert.rejects(readJsonBody({ body: 'x'.repeat(24 * 1024 + 1) }), /REQUEST_BODY_TOO_LARGE/);
  await assert.rejects(readJsonBody({ body: { value: 'x'.repeat(24 * 1024) } }), /REQUEST_BODY_TOO_LARGE/);
});

test('enforces the request limit while reading a streamed JSON body', async () => {
  const request = {
    body: undefined,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{"entries":[]}', 'utf8');
    },
  };
  assert.deepEqual(await readJsonBody(request), { entries: [] });
});
