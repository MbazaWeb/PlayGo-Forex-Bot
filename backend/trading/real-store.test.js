import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readAgentFailures,
  readAutoStartPreference,
  readTradeEvidence,
  recordAgentFailure,
  recordSettlementEvidence,
  writeAutoStartPreference,
} from './real-store.js';

const localEnv = {
  PLAYGO_ENV: 'local',
  PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
  PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890',
};

test('records an account-scoped agent failure with useful market context', async () => {
  let inserted;
  await recordAgentFailure({
    accountId: 'DOT1234',
    status: 'watching',
    reason: 'MARKET_DATA_GAP',
    symbol: 'R_100',
    granularity: 300,
    automatic: true,
    env: localEnv,
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).pathname, '/playgo_real_audit');
      inserted = JSON.parse(init.body);
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(inserted.account_id, 'DOT1234');
  assert.equal(inserted.event_type, 'AGENT_FAILURE');
  assert.deepEqual(inserted.event_data, {
    status: 'watching',
    reason: 'MARKET_DATA_GAP',
    symbol: 'R_100',
    granularity: 300,
    mode: 'automatic',
  });
});

test('reads failures only within the requested timestamp window', async () => {
  const from = 1_760_000_000;
  const to = from + 3600;
  let calls = 0;
  const intentId = 'c3e219de-9cc0-4fb9-866a-215438234c18';
  const result = await readAgentFailures({
    accountId: 'DOT1234',
    from,
    to,
    env: localEnv,
    fetchImpl: async url => {
      calls++;
      const { pathname, searchParams: query } = new URL(url);
      if (pathname.endsWith('playgo_real_intents')) {
        assert.equal(query.get('id'), 'in.(' + intentId + ')');
        return Response.json([{
          id: intentId, symbol: 'R_100', contract_type: 'CALL', duration: 5, stake: 10,
        }]);
      }
      assert.equal(query.get('account_id'), 'eq.DOT1234');
      assert.equal(query.get('event_type'), 'in.(AGENT_FAILURE,ORDER_REJECT,ORDER_UNKNOWN,CLOSE_RESULT)');
      assert.equal(query.get('and'),
        '(created_at.gte.' + new Date(from * 1000).toISOString() +
        ',created_at.lte.' + new Date(to * 1000).toISOString() + ')');
      if (query.has('id')) return Response.json([]);
      return Response.json([
        {
          id: 22, intent_id: intentId, event_type: 'ORDER_REJECT',
          event_data: { from: 'submitted', to: 'rejected' },
          created_at: new Date((from + 60) * 1000).toISOString(),
        },
        {
          id: 21, intent_id: null, event_type: 'AGENT_FAILURE',
          event_data: { status: 'error', reason: 'AGENT_OPERATION_FAILED', symbol: 'R_100', mode: 'automatic' },
          created_at: new Date((from + 30) * 1000).toISOString(),
        },
        {
          id: 20, intent_id: null, event_type: 'CLOSE_RESULT',
          event_data: {
            close_status: 'unconfirmed', outcome: 'unconfirmed',
            contract_id: '12345', transaction_id: '54321',
            stake: 10, requested_at: '2025-10-09T10:00:00.000Z',
            confirmed_at: null, reason: 'CLOSE_UNCONFIRMED',
          },
          created_at: new Date((from + 15) * 1000).toISOString(),
        },
      ]);
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.complete, true);
  assert.equal(result.failures.length, 3);
  const agentFailure = result.failures.find(failure => failure.event === 'AGENT_FAILURE');
  const rejectedOrder = result.failures.find(failure => failure.event === 'ORDER_REJECT');
  assert.equal(agentFailure.reason, 'AGENT_OPERATION_FAILED');
  assert.equal(rejectedOrder.reason, 'ORDER_REJECTED');
  assert.equal(rejectedOrder.symbol, 'R_100');
  assert.equal(rejectedOrder.from, 'submitted');
  const closeFailure = result.failures.find(failure => failure.event === 'CLOSE_RESULT');
  assert.equal(closeFailure.status, 'error');
  assert.equal(closeFailure.contractId, '12345');
  assert.equal(closeFailure.transactionId, '54321');
  assert.equal(closeFailure.requestedAt, '2025-10-09T10:00:00.000Z');
});

test('settlement reconciliation preserves the buy transaction ID', async () => {
  const writes = [];
  await recordSettlementEvidence({
    accountId: 'DOT1234',
    transactions: [{
      id: '98765', contractId: '12345', buy: 10, sell: 8, settledAt: 1_760_000_000,
    }],
    env: localEnv,
    fetchImpl: async (url, options) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname.endsWith('playgo_real_intents')) {
        assert.equal(options.method, 'PATCH');
        assert.equal(searchParams.get('settled_at'), 'is.null');
        writes.push(JSON.parse(options.body));
        return Response.json([{ id: 'intent-1' }]);
      }
      writes.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(writes[0].broker_settlement_transaction_id, '98765');
  assert.equal(Object.hasOwn(writes[0], 'broker_transaction_id'), false);
  assert.equal(writes[1].event_type, 'SETTLEMENT_RECONCILED');
});

test('trade evidence spans ID batches and finds exit records after the first 500', async () => {
  const ids = Array.from({ length: 101 }, (_, index) => String(1000 + index));
  const batches = [];
  const evidence = await readTradeEvidence({
    accountId: 'DOT1234', contractIds: ids,
    env: localEnv,
    fetchImpl: async url => {
      const { pathname, searchParams: query } = new URL(url);
      assert.equal(query.get('account_id'), 'eq.DOT1234');
      if (pathname.endsWith('playgo_real_intents')) {
        const batch = query.get('broker_contract_id').slice(4, -1).split(',');
        batches.push(batch.length);
        return Response.json(batch.map(id => ({
          id, broker_contract_id: id, broker_transaction_id: '67890',
          broker_settlement_transaction_id: '98765',
        })));
      }
      if (query.get('event_type') === 'eq.ORDER_STRATEGY') {
        if (query.has('id')) return Response.json([]);
        return Response.json(query.get('intent_id').slice(4, -1).split(',')
          .map(id => ({ id: Number(id), intent_id: id, event_data: { strategy: 'Trend', score: 85 } })));
      }
      if (query.get('event_type') === 'eq.CLOSE_RESULT' && query.has('id'))
        return Response.json([]);
      if (query.get('event_type') === 'eq.CLOSE_RESULT')
        return Response.json([
          {
            id: 2,
            event_data: {
              contract_id: '1100', close_status: 'confirmed',
              outcome: 'lost', transaction_id: '54321',
            },
            created_at: '2026-11-23T12:01:00.000Z',
          },
          {
            id: 1,
            event_data: {
              contract_id: '1100', close_status: 'unconfirmed',
              outcome: 'unconfirmed', reason: 'CLOSE_UNCONFIRMED',
            },
            created_at: '2026-11-23T12:00:00.000Z',
          },
        ]);
      if (query.get('event_type')?.startsWith('in.(')) return Response.json([]);
      const cursor = query.get('id');
      if (!cursor) {
        return Response.json(Array.from({ length: 500 }, (_, i) => ({
          id: 1000 - i,
          event_data: {
            checks: i === 0 ? [{ contractId: '1100', outcome: 'CLOSED', soldFor: 0 }] : [],
          },
        })));
      }
      if (cursor === 'lt.501') {
        return Response.json([{ id: 500, event_data: { checks: [{ contractId: '1100', outcome: 'CLOSED', soldFor: 8 }] } }]);
      }
      assert.equal(cursor, 'lt.500');
      return Response.json([]);
    },
  });
  assert.deepEqual(batches, [100, 1]);
  assert.equal(evidence['1100'].strategy, 'Trend');
  assert.equal(evidence['1100'].execution.settlementTransactionId, '98765');
  assert.equal(evidence['1100'].exit.outcome, 'CLOSED');
  assert.equal(evidence['1100'].exit.soldFor, 0);
  assert.equal(evidence['1100'].close.status, 'confirmed');
  assert.equal(evidence['1100'].close.transactionId, '54321');
});

test('auto-start preferences default off and persist by account', async () => {
  let write;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    assert.match(parsed.pathname, /playgo_account_settings$/);
    if (options.method === 'POST') {
      write = { query: parsed.searchParams, body: JSON.parse(options.body) };
      return new Response(null, { status: 204 });
    }
    assert.equal(parsed.searchParams.get('account_id'), 'eq.DOT1234');
    return Response.json([]);
  };
  assert.equal(await readAutoStartPreference({
    accountId: 'DOT1234', env: localEnv, fetchImpl,
  }), false);
  await writeAutoStartPreference({
    accountId: 'DOT1234', enabled: true, env: localEnv, fetchImpl,
  });
  assert.equal(write.query.get('on_conflict'), 'account_id');
  assert.deepEqual(write.body, {
    account_id: 'DOT1234',
    auto_start_enabled: true,
    updated_at: write.body.updated_at,
  });
  assert.ok(Number.isFinite(Date.parse(write.body.updated_at)));
});
