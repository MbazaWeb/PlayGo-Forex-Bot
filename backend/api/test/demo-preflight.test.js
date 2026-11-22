import test from 'node:test';
import assert from 'node:assert/strict';
import { manualTicket } from '../src/manual-demo.js';

const accountId = 'demo123';
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-only-key',
  LIVE_TRADING_ENABLED: 'false',
  PLAYGO_DEMO_EXECUTION_ENABLED: 'true',
  DERIV_DEMO_ACCOUNT_ID: accountId,
  PLAYGO_BROKER_DEMO_ACCOUNT: accountId,
};

function input(state) {
  return {
    method: 'GET',
    params: new URLSearchParams({ account: accountId }),
    token: 'fixture-only-token',
    appId: 'fixture-client',
    env,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/accounts')) {
        return Response.json({ data: [{ account_id: accountId, account_type: 'demo' }] });
      }
      if (String(url).endsWith('/rpc/playgo_broker_demo_state')) {
        return Response.json(state);
      }
      assert.fail('Unexpected fixture request');
    },
  };
}

test('demo ticket preflight returns qualification and recovery evidence', async () => {
  const result = await manualTicket(input({
    qualified: true,
    paused: false,
    unresolved: false,
    lastRecoveryAt: new Date().toISOString(),
    dailyRealizedPnl: '-1.25',
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(
    {
      ready: result.body.ready,
      qualified: result.body.qualified,
      paused: result.body.paused,
      unresolved: result.body.unresolved,
      lastRecoveryAt: result.body.lastRecoveryAt,
      dailyRealizedPnl: result.body.dailyRealizedPnl,
    },
    {
      ready: true,
      qualified: true,
      paused: false,
      unresolved: false,
      lastRecoveryAt: result.body.lastRecoveryAt,
      dailyRealizedPnl: -1.25,
    },
  );
  assert.ok(Number.isFinite(Date.parse(result.body.lastRecoveryAt)));
});

test('demo ticket preflight explains pending qualification without enabling orders', async () => {
  const result = await manualTicket(input({
    qualified: false,
    paused: true,
    unresolved: false,
    lastRecoveryAt: null,
    dailyRealizedPnl: '0',
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ready, false);
  assert.equal(result.body.qualified, false);
  assert.equal(result.body.lastRecoveryAt, null);
  assert.equal(result.body.message, 'Demo account qualification is pending.');
});

test('disabled demo execution returns a readable GET status without broker or database requests', async () => {
  const result = await manualTicket({
    method: 'GET',
    params: new URLSearchParams({ account: accountId }),
    env: { LIVE_TRADING_ENABLED: 'false', PLAYGO_DEMO_EXECUTION_ENABLED: 'false' },
    fetchImpl: assert.fail,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ready, false);
  assert.equal(result.body.message, 'Demo orders are disabled.');
  assert.equal(result.body.qualified, null);
});

test('disabled demo execution still rejects order submissions', async () => {
  const result = await manualTicket({
    method: 'POST',
    params: new URLSearchParams({ account: accountId }),
    env: { LIVE_TRADING_ENABLED: 'false', PLAYGO_DEMO_EXECUTION_ENABLED: 'false' },
    fetchImpl: assert.fail,
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.ready, false);
});
