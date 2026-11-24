import assert from 'node:assert/strict';
import test from 'node:test';
import { readTradeEvidence } from './real-store.js';

test('trade evidence spans ID batches and finds exit records after the first 500', async () => {
  const ids = Array.from({ length: 101 }, (_, index) => String(1000 + index));
  const batches = [];
  const evidence = await readTradeEvidence({
    accountId: 'DOT1234', contractIds: ids,
    env: { PLAYGO_ENV: 'local', PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
      PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890' },
    fetchImpl: async url => {
      const { pathname, searchParams: query } = new URL(url);
      assert.equal(query.get('account_id'), 'eq.DOT1234');
      if (pathname.endsWith('playgo_real_intents')) {
        const batch = query.get('broker_contract_id').slice(4, -1).split(',');
        batches.push(batch.length);
        return Response.json(batch.map(id => ({ id, broker_contract_id: id })));
      }
      if (query.get('event_type') === 'eq.ORDER_STRATEGY') {
        if (query.has('id')) return Response.json([]);
        return Response.json(query.get('intent_id').slice(4, -1).split(',')
          .map(id => ({ id: Number(id), intent_id: id, event_data: { strategy: 'Trend', score: 85 } })));
      }
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
  assert.equal(evidence['1100'].exit.outcome, 'CLOSED');
  assert.equal(evidence['1100'].exit.soldFor, 0);
});
