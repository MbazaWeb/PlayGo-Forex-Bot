import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettlementRange } from '../../trading/execute.js';
import { readHistory } from '../src/portfolio/index.js';

const account = { account_id: 'CR123456', account_type: 'real', currency: 'USD', balance: 1000 };
const otp = async () => Response.json({ data: { url: 'wss://api.derivws.com/trading/v1/options/ws/real?otp=fixture' } });

// Serves `total` settlements in pages of up to 100, honouring offset and sort ASC.
function pagedSocket(total, { duplicateAt = null } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({
    transaction_id: 1000 + i, contract_id: 2000 + i, buy_price: 10, sell_price: i % 2 ? 0 : 17,
    sell_time: 1_763_000_000 + i * 60,
  }));
  if (duplicateAt !== null) rows.push({ ...rows[duplicateAt] });
  return class {
    constructor() { this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(raw) {
      const request = JSON.parse(raw);
      const page = rows.slice(request.offset, request.offset + request.limit);
      const response = { req_id: request.req_id, msg_type: 'profit_table', profit_table: { transactions: page } };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
    }
    close() { this.readyState = 3; }
  };
}

test('pages through a range until the last short page and removes duplicates', async () => {
  const result = await readSettlementRange({
    account, token: 'fixture', fetchImpl: otp, Socket: pagedSocket(250, { duplicateAt: 3 }),
    from: 1_763_000_000, to: 1_763_100_000,
  });
  assert.equal(result.complete, true);
  assert.equal(result.transactions.length, 250);
  assert.equal(result.transactions[0].settledAt, 1_763_000_000);
  assert.equal(result.transactions.at(-1).settledAt, 1_763_000_000 + 249 * 60);
});

test('reports incomplete when the row cap is reached, so the report never presents a partial sample as whole', async () => {
  const result = await readSettlementRange({
    account, token: 'fixture', fetchImpl: otp, Socket: pagedSocket(500),
    from: 1_763_000_000, to: 1_763_100_000, maxRows: 200,
  });
  assert.equal(result.complete, false);
  assert.equal(result.transactions.length, 200);
});

test('rejects an invalid range before opening a broker connection', async () => {
  await assert.rejects(readSettlementRange({
    account, token: 'fixture', fetchImpl: otp, Socket: pagedSocket(1), from: 10, to: 5,
  }), { code: 'INVALID_HISTORY_RANGE' });
});

test('non-page-aligned caps never return more than the requested limit', async () => {
  const result = await readSettlementRange({
    account, token: 'fixture', fetchImpl: otp, Socket: pagedSocket(250),
    from: 1_763_000_000, to: 1_763_100_000, maxRows: 125,
  });
  assert.equal(result.complete, false);
  assert.equal(result.transactions.length, 125);
});

test('range pages resume from the supplied broker offset', async () => {
  const first = await readSettlementRange({
    account, token: 'fixture', fetchImpl: otp, Socket: pagedSocket(250),
    from: 1_763_000_000, to: 1_763_100_000, offset: 100, maxRows: 100,
  });
  assert.equal(first.complete, false);
  assert.equal(first.transactions.length, 100);
  assert.equal(first.transactions[0].id, '1100');
  assert.equal(first.nextOffset, 200);

  const last = await readSettlementRange({
    account, token: 'fixture', fetchImpl: otp, Socket: pagedSocket(250),
    from: 1_763_000_000, to: 1_763_100_000, offset: first.nextOffset, maxRows: 100,
  });
  assert.equal(last.complete, true);
  assert.equal(last.transactions.length, 50);
  assert.equal(last.nextOffset, 250);
});

test('history reports accept ranges up to 93 days and reject longer ranges', async () => {
  const now = Math.floor(Date.now() / 1000);
  const range = (days) => ({
    mode: '1',
    from: String(now - days * 24 * 60 * 60),
    to: String(now),
  });
  const emptySocket = class {
    constructor() {
      this.readyState = 0;
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
    }

    send(raw) {
      const request = JSON.parse(raw);
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify({
          req_id: request.req_id,
          msg_type: 'profit_table',
          profit_table: { transactions: [] },
        }),
      }));
    }

    close() {
      this.readyState = 3;
    }
  };
  const accountRequest = {
    account,
    token: 'fixture',
    fetchImpl: otp,
    Socket: emptySocket,
  };

  const accepted = await readHistory({
    ...accountRequest,
    range: range(93),
    limit: 500,
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.complete, true);

  const rejected = await readHistory({
    ...accountRequest,
    range: range(94),
    limit: 500,
  });
  assert.equal(rejected.status, 400);
});

test('report history includes account-scoped technical failures for the selected window', async () => {
  const keys = ['PLAYGO_ENV', 'PLAYGO_LOCAL_REST_URL', 'PLAYGO_LOCAL_WORKER_JWT'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    PLAYGO_ENV: 'local',
    PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
    PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890',
  });
  const now = Math.floor(Date.now() / 1000);
  let auditCalls = 0;
  const resultPromise = readHistory({
    account,
    token: 'fixture',
    appId: 'fixture',
    accountRef: 'abcdefghijklmnopqrstuv',
    env: {
      PLAYGO_ENV: 'local',
      PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
      PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890',
      VERCEL_ACCESS_TOKEN: 'fixture-vercel-token',
      VERCEL_PROJECT_ID: 'prj_fixture',
    },
    range: { mode: '1', from: String(now - 3600), to: String(now) },
    includeEvidence: true,
    fetchImpl: async url => {
      if (String(url).startsWith('https://api.vercel.com/v7/deployments'))
        return Response.json({ deployments: [] });
      if (!url.startsWith('http://127.0.0.1:3000/')) return otp();
      const { pathname, searchParams } = new URL(url);
      assert.equal(pathname, '/playgo_real_audit');
      auditCalls++;
      if (searchParams.has('id')) return Response.json([]);
      return Response.json([{
        id: 1,
        intent_id: null,
        event_type: 'AGENT_FAILURE',
        event_data: { status: 'watching', reason: 'MARKET_DATA_GAP', symbol: 'R_100' },
        created_at: new Date((now - 60) * 1000).toISOString(),
      }]);
    },
    Socket: class {
      constructor() {
        this.readyState = 0;
        queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
      }

      send(raw) {
        const request = JSON.parse(raw);
        queueMicrotask(() => this.onmessage?.({
          data: JSON.stringify({
            req_id: request.req_id, msg_type: 'profit_table', profit_table: { transactions: [] },
          }),
        }));
      }

      close() { this.readyState = 3; }
    },
  });
  try {
    const result = await resultPromise;
    assert.equal(result.status, 200);
    assert.equal(result.body.transactions.length, 0);
    assert.equal(result.body.failuresComplete, true);
    assert.equal(result.body.failures[0].reason, 'MARKET_DATA_GAP');
    assert.equal(result.body.serverLogs.status, 'complete');
    assert.equal(result.body.serverLogs.logs.length, 0);
    assert.equal(auditCalls, 2);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
