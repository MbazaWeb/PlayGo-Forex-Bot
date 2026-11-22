import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const origin = 'https://terminal.example';
const callback = origin + '/api/auth/deriv/callback';
process.env.APP_ORIGIN = origin;
process.env.DERIV_CLIENT_ID = 'test-app';
process.env.PLAYGO_COOKIE_SECRET = 'test-only-cookie-secret-with-32-characters';
delete process.env.DERIV_REDIRECT_URI;

const { default: handler } = await import('../api/handler.js');

async function request(route, { host = 'terminal.example', cookie, ...query } = {}) {
  const headers = new Map();
  const res = {
    setHeader: (name, value) => headers.set(name, value),
    writeHead(status, fields) { this.statusCode = status; Object.entries(fields).forEach(([name, value]) => headers.set(name, value)); },
    status(status) { this.statusCode = status; return this; },
    json(body) { this.body = body; },
    end() {}
  };
  await handler({ method: 'GET', headers: { host, cookie }, query: { route, ...query } }, res);
  return { headers, status: res.statusCode, body: res.body };
}

test('alias starts sign-in on the registered callback host before setting cookies', async () => {
  const result = await request('auth/deriv/start', { host: 'alias.example' });
  assert.equal(result.status, 302);
  assert.equal(result.headers.get('Location'), origin + '/api/auth/deriv/start');
  assert.equal(result.headers.has('Set-Cookie'), false);
});

test('serverless callback verifies PKCE and creates the session used by the dashboard', async t => {
  const start = await request('auth/deriv/start');
  const auth = new URL(start.headers.get('Location'));
  assert.equal(auth.searchParams.get('redirect_uri'), callback);
  const cookie = start.headers.get('Set-Cookie').split(';')[0];
  const state = auth.searchParams.get('state');
  const exchange = t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    assert.equal(body.get('redirect_uri'), callback);
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
      auth.searchParams.get('code_challenge'));
    return Response.json({ access_token: 'test-token', expires_in: 3600 });
  });

  const invalid = await request('auth/deriv/callback', { cookie, state: [state], code: 'test-code' });
  assert.equal(invalid.headers.get('Location'), origin + '/?auth_error=invalid_callback');
  assert.equal(exchange.mock.callCount(), 0);

  const result = await request('auth/deriv/callback', { cookie, state, code: 'test-code' });
  assert.equal(result.headers.get('Location'), origin + '/');
  assert.equal(exchange.mock.callCount(), 1);
  const [cleared, session] = result.headers.get('Set-Cookie');
  assert.match(cleared, /Max-Age=0/);
  assert.match(session, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await request('session', { cookie: session.split(';')[0] })).body.authenticated, true);
});
