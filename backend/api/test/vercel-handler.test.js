import assert from 'node:assert/strict';
import {test} from 'node:test';
import handler from '../src/vercel-handler.js';

function responseRecorder() {
  return {
    setHeader() {},
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      this.body = body;
    }
  };
}

test('API handler resolves public /api paths without a rewrite query', async () => {
  const res = responseRecorder();

  await handler({method: 'GET', url: '/api/health', query: {}, headers: {}}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {status: 'ok', execution: false});
});

test('API handler preserves routes supplied by the existing rewrite', async () => {
  const res = responseRecorder();

  await handler({method: 'GET', url: '/api/handler?route=health', query: {route: 'health'}, headers: {}}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {status: 'ok', execution: false});
});
