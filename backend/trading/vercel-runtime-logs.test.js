import assert from 'node:assert/strict';
import test from 'node:test';
import { readVercelRuntimeLogs } from './vercel-runtime-logs.js';

const accountReference = 'abcdefghijklmnopqrstuv';

test('reads only correlated runtime logs and includes deployment identifiers', async () => {
  const now = Date.parse('2026-02-01T12:00:00.000Z');
  const from = (now - 60 * 60 * 1000) / 1000;
  const to = now / 1000;
  const calls = [];
  const result = await readVercelRuntimeLogs({
    accountReference,
    from,
    to,
    now,
    env: { VERCEL_ACCESS_TOKEN: 'server-token', VERCEL_PROJECT_ID: 'prj_example' },
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      calls.push({ parsed, options });
      if (parsed.pathname === '/v7/deployments') return Response.json({ deployments: [{ uid: 'dpl_12345678' }] });
      assert.equal(parsed.pathname, '/v1/projects/prj_example/deployments/dpl_12345678/runtime-logs');
      return Response.json([
        {
          timestampInMs: now - 1000,
          level: 'info',
          requestId: 'request-1',
          requestMethod: 'GET',
          requestPath: '/api/history',
          responseStatusCode: 200,
          message: JSON.stringify({
            event: 'playgo.api.request',
            requestId: 'request-1',
            accountReference,
            method: 'GET',
            route: 'history',
            statusCode: 200,
          }),
        },
        {
          timestampInMs: now - 500,
          level: 'error',
          requestId: 'request-1',
          requestMethod: 'GET',
          requestPath: '/api/history',
          responseStatusCode: 500,
          message: 'code=E_REPORT_FAILED access_token=secret-value',
        },
        {
          timestampInMs: now - 250,
          level: 'error',
          requestId: 'other-request',
          message: JSON.stringify({ accountReference: 'another-account' }),
        },
      ]);
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-token');
  assert.equal(result.status, 'complete');
  assert.equal(result.complete, true);
  assert.equal(result.logs.length, 2);
  assert.ok(result.logs.every((log) => log.deploymentId === 'dpl_12345678'));
  assert.equal(result.logs[1].message, 'code=E_REPORT_FAILED access_token=[REDACTED]');
  assert.equal(result.logs[1].requestId, 'request-1');
});

test('reports missing server credentials without making external requests', async () => {
  let called = false;
  const result = await readVercelRuntimeLogs({
    accountReference,
    from: 1_767_268_800,
    to: 1_767_272_400,
    env: {},
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.complete, false);
  assert.match(result.note, /server-only/);
});
