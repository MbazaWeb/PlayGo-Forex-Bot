import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import vercelHandler from '../src/vercel-handler.js';

const config = {
  origin: 'http://localhost:5173',
  clientId: 'test-client',
  redirectUri: 'http://localhost:5173/api/auth/deriv/callback',
};

async function appRequest(t, path, options = {}) {
  const server = createServer(createApp(config, { fetcher: assert.fail }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    redirect: 'manual',
    ...options,
  });
}

function vercelResponse() {
  return {
    code: 0,
    body: null,
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('Node API always blocks real-money routes before authentication', async (t) => {
  const cases = [
    ['/api/live/ticket', 'GET'],
    ['/api/live/ticket', 'POST'],
    ['/api/live/strategy', 'GET'],
    ['/api/live/strategy', 'POST'],
    ['/api/live/portfolio', 'GET'],
    ['/api/live/portfolio', 'POST'],
    ['/api/live/ticket', 'DELETE'],
    ['/api/live/unknown', 'GET'],
    ['/api/live/ticket/', 'GET'],
  ];
  for (const [path, method] of cases) {
    const response = await appRequest(t, path, { method });
    assert.equal(response.status, 403, `${method} ${path}`);
  }
});

test('Vercel API always blocks real-money routes before authentication', async () => {
  const cases = [
    ['/api/live/ticket', 'GET'],
    ['/api/live/ticket', 'POST'],
    ['/api/live/strategy', 'GET'],
    ['/api/live/strategy', 'POST'],
    ['/api/live/portfolio', 'GET'],
    ['/api/live/portfolio', 'POST'],
    ['/api/live/ticket', 'DELETE'],
    ['/api/live/unknown', 'GET'],
    ['/api/live/ticket/', 'GET'],
  ];
  for (const [url, method] of cases) {
    const res = vercelResponse();
    await vercelHandler({ method, url, query: {}, headers: {} }, res);
    assert.equal(res.code, 403, `${method} ${url}`);
    assert.match(res.body.error, /unavailable/i);
  }
});
