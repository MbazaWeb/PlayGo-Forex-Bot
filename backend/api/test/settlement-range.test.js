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
