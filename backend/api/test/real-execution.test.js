import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { executeRealOrder, getRealWebSocketUrl, readRealPortfolio, readRealHistory } from '../../trading/execute.js';
import {
  evaluateEmergencyStop,
  calculateStake,
  contractsAtExitThresholds,
  validExitSettings,
} from '../../trading/agents/risk/index.js';
import { runEmergencyCheck } from '../../trading/agents/emergency/index.js';
import { placeRealAgentOrders, runRealAgentTick } from '../../trading/agents/trade-agent/index.js';

const realAccount = {
  account_id: 'CR123456',
  account_type: 'real',
  currency: 'USD',
  balance: 1000,
};

class BrokerSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(raw) {
    const request = JSON.parse(raw);
    this.sent.push(request);
    const response = request.proposal
      ? { req_id: request.req_id, msg_type: 'proposal', proposal: { id: 'proposal-1', ask_price: 10 } }
      : { req_id: request.req_id, msg_type: 'buy', buy: { contract_id: 12345 } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const otpFetch = async () => Response.json({
  data: { url: 'wss://api.derivws.com/trading/v1/options/ws/real?otp=fixture' },
});

test('Deriv OTP endpoint matches the selected account type', async () => {
  const url = await getRealWebSocketUrl({
    token: 'fixture',
    account: realAccount,
    fetchImpl: otpFetch,
  });
  assert.match(url, /\/ws\/real\?otp=/);
  const demoAccount = { ...realAccount, account_id: 'DOT123456', account_type: 'demo' };
  const demoOtp = async (url, options) => {
    assert.match(url, /\/accounts\/DOT123456\/otp$/);
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    return Response.json({
      data: { url: 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=fixture' },
    });
  };
  assert.match(await getRealWebSocketUrl({
    token: 'fixture', account: demoAccount, fetchImpl: demoOtp,
  }), /\/ws\/demo\?otp=/);
  await assert.rejects(getRealWebSocketUrl({
    token: 'fixture', account: demoAccount, fetchImpl: otpFetch,
  }), /INVALID_REAL_ENDPOINT/);
  await assert.rejects(getRealWebSocketUrl({
    token: 'fixture',
    account: { ...realAccount, account_type: 'unknown' },
    fetchImpl: assert.fail,
  }), /REAL_ACCOUNT_REQUIRED/);
  await assert.rejects(getRealWebSocketUrl({
    token: 'fixture',
    account: realAccount,
    fetchImpl: async () => Response.json({
      data: { url: 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=fixture' },
    }),
  }), /INVALID_REAL_ENDPOINT/);
});

for (const accountType of ['demo']) {
  test(`${accountType} buy is persisted before the broker receives the buy request`, async () => {
    const events = [];
    const order = await executeRealOrder({
      account: { ...realAccount, account_type: accountType },
      token: 'fixture',
      intent: {
        symbol: 'R_75',
        contractType: 'CALL',
        stake: 10,
        duration: 1,
        durationUnit: 'm',
      },
      fetchImpl: async () => Response.json({
        data: { url: `wss://api.derivws.com/trading/v1/options/ws/${accountType}?otp=fixture` },
      }),
      Socket: class extends BrokerSocket {
        constructor(url) {
          assert.match(url, new RegExp('/ws/' + accountType + '\\?otp='));
          super(url);
        }
  
        send(raw) {
          const request = JSON.parse(raw);
          if (request.buy) events.push('buy-request');
          super.send(raw);
        }
      },
      beforeBuy: async () => { events.push('persist-submit'); },
    });
    events.push('confirmed');
    assert.deepEqual(order, { contractId: '12345', askPrice: 10 });
    assert.deepEqual(events, ['persist-submit', 'buy-request', 'confirmed']);
  });
}

test('stake sizing and emergency threshold are measured from the stored starting balance', async () => {
  assert.equal(calculateStake(1000), 10);
  assert.equal(calculateStake(9623.48, 'USD'), 96.23);
  assert.equal(evaluateEmergencyStop({
    startingBalance: 1000,
    balance: 850,
    openProfit: -50,
  }).stopped, true);
  assert.equal(evaluateEmergencyStop({
    startingBalance: 1000,
    balance: 850,
    openProfit: 0,
  }).stopped, false);
});

test('per-contract exits compare verified P&L with configured percentages of stake', () => {
  assert.equal(validExitSettings(10, 25), true);
  assert.equal(validExitSettings(101, 25), false);
  assert.equal(validExitSettings(10, 0), false);
  const contracts = [
    { id: '1', stake: 10, profit: -1 },
    { id: '2', stake: 20, profit: 5 },
    { id: '3', stake: 10, profit: -0.99 },
    { id: '4', stake: 10, profit: 2.49 },
    { id: '5', stake: 0, profit: -10 },
  ];
  assert.deepEqual(
    contractsAtExitThresholds(contracts, 10, 25).map(contract => contract.id),
    ['1', '2'],
  );
});

test('one-time order requests reject missing exit settings before database or broker access', async () => {
  await assert.rejects(placeRealAgentOrders({
    accounts: [realAccount],
    token: 'fixture',
    symbol: 'R_75',
    granularity: 60,
    stopLossPercent: 0,
    takeProfitPercent: 25,
    env: { LIVE_TRADING_ENABLED: 'true', LIVE_TRADING_CONFIRM: 'CR123456' },
    fetchImpl: assert.fail,
  }), /INVALID_EXIT_SETTINGS/);
});

test('one-time trade checks restore an inactive control after a non-qualifying analysis', async () => {
  const events = [];
  let control = null;
  const env = {
    LIVE_TRADING_ENABLED: 'true', LIVE_TRADING_CONFIRM: 'CR123456',
    PLAYGO_ENV: 'local',
    PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
    PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890',
  };
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/playgo_real_controls')) {
      events.push('read-control');
      return Response.json(control ? [control] : []);
    }
    if (parsed.pathname.endsWith('/rpc/playgo_real_configure_control')) {
      events.push('start-control');
      control = {
        account_id: realAccount.account_id,
        starting_balance: 1000,
        active: true,
        paused: false,
        stop_loss_percent: 10,
        take_profit_percent: 25,
      };
      return Response.json({ active: true });
    }
    if (parsed.pathname.endsWith('/rpc/playgo_real_stop_control')) {
      events.push('stop-control');
      control.active = false;
      return Response.json({ active: false });
    }
    if (parsed.pathname.endsWith('/otp')) {
      events.push('request-otp');
      return Response.json({
        data: { url: 'wss://api.derivws.com/trading/v1/options/ws/real?otp=fixture' },
      });
    }
    throw Error(`Unexpected mocked request: ${options.method || 'GET'} ${parsed.pathname}`);
  };
  class EmptyMarketSocket {
    constructor() {
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }

    send(raw) {
      const request = JSON.parse(raw);
      const response = request.portfolio
        ? { req_id: request.req_id, msg_type: 'portfolio', portfolio: { contracts: [] } }
        : { req_id: request.req_id, candles: [] };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const results = await placeRealAgentOrders({
    accounts: [realAccount],
    token: 'fixture',
    appId: 'fixture',
    symbol: 'R_75',
    granularity: 60,
    stopLossPercent: 10,
    takeProfitPercent: 25,
    env,
    fetchImpl,
    Socket: EmptyMarketSocket,
    now: () => 1_000_000_000,
  });
  assert.equal(results[0].status, 'watching');
  assert.equal(control.active, false);
  assert.ok(events.includes('start-control'));
  assert.ok(events.includes('stop-control'));
  assert.equal(events.includes('buy-request'), false);
});

test('one-time qualifying order keeps Bot Agents active for scheduled monitoring', async () => {
  const events = [];
  let control = null;
  const env = {
    LIVE_TRADING_ENABLED: 'true', LIVE_TRADING_CONFIRM: 'CR123456',
    PLAYGO_ENV: 'local',
    PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
    PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890',
  };
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/playgo_real_controls'))
      return Response.json(control ? [control] : []);
    if (parsed.pathname.endsWith('/rpc/playgo_real_configure_control')) {
      events.push('start-control');
      control = {
        account_id: realAccount.account_id,
        starting_balance: 1000,
        active: true,
        paused: false,
        stop_loss_percent: 10,
        take_profit_percent: 25,
      };
      return Response.json({ active: true });
    }
    if (parsed.pathname.endsWith('/rpc/playgo_real_stop_control')) {
      events.push('stop-control');
      control.active = false;
      return Response.json({ active: false });
    }
    if (parsed.pathname.endsWith('/rpc/playgo_real_reserve_intent')) {
      events.push('reserve-intent');
      return Response.json({ accepted: true, intentId: '00000000-0000-4000-8000-000000000001' });
    }
    if (parsed.pathname.endsWith('/rpc/playgo_real_transition')) {
      const event = JSON.parse(options.body).p_event;
      events.push(`intent-${event}`);
      return Response.json({ status: event });
    }
    if (parsed.pathname.endsWith('/otp'))
      return Response.json({
        data: { url: 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=fixture' },
      });
    throw Error(`Unexpected mocked request: ${parsed.pathname}`);
  };
  class QualifyingMarketSocket {
    constructor() {
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }

    send(raw) {
      const request = JSON.parse(raw);
      let response;
      if (request.portfolio) {
        response = { req_id: request.req_id, msg_type: 'portfolio', portfolio: { contracts: [] } };
      } else if (request.ticks_history) {
        events.push('read-candles');
        const candles = Array.from({ length: 80 }, (_, index) => {
          const close = 100 + index * 0.12 + Math.sin(index * 1.1) * 0.5;
          return {
            epoch: 1_800_000_000 - (80 - index) * 60,
            open: close - 0.1,
            high: close + 0.2,
            low: close - 0.2,
            close,
          };
        });
        response = { req_id: request.req_id, candles };
      } else if (request.proposal) {
        response = { req_id: request.req_id, msg_type: 'proposal', proposal: { id: 'proposal-1', ask_price: 10 } };
      } else if (request.buy) {
        events.push('buy-request');
        response = { req_id: request.req_id, msg_type: 'buy', buy: { contract_id: 12345 } };
      } else if (request.profit_table) {
        response = { req_id: request.req_id, msg_type: 'profit_table', profit_table: { transactions: [] } };
      } else {
        throw Error('Unexpected mocked broker request');
      }
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const request = {
    accounts: [{ ...realAccount, account_type: 'demo' }],
    token: 'fixture',
    appId: 'fixture',
    symbol: 'R_75',
    granularity: 60,
    stopLossPercent: 10,
    takeProfitPercent: 25,
    env,
    fetchImpl,
    Socket: QualifyingMarketSocket,
    now: () => 1_800_000_000_000,
  };
  const results = await placeRealAgentOrders(request);
  assert.equal(results[0].status, 'ordered');
  assert.equal(results[0].automationActive, true);
  assert.equal(control.active, true);
  assert.ok(events.includes('buy-request'));
  assert.ok(!events.includes('stop-control'));

  events.length = 0;
  const exitCheck = await runRealAgentTick({ ...request, account: { ...realAccount, account_type: 'demo' }, exitsOnly: true });
  assert.equal(exitCheck.reason, 'EXIT_MONITORING');
  assert.ok(!events.includes('read-candles'));
  assert.ok(!events.includes('reserve-intent'));
  assert.ok(!events.includes('buy-request'));

  for (const [terminalAction, contractType] of [['buy', 'CALL'], ['sell', 'PUT']]) {
    control = null;
    events.length = 0;
    const [order] = await placeRealAgentOrders({ ...request, terminalAction });
    assert.equal(order.status, 'ordered');
    assert.equal(order.contractType, contractType);
    assert.equal(order.automationActive, false);
    assert.ok(events.includes('buy-request'));
    assert.ok(events.includes('stop-control'));
    assert.ok(!events.includes('read-candles'));
  }
});

test('active control settings cannot be replaced by a one-time request', async () => {
  const control = {
    account_id: realAccount.account_id,
    starting_balance: 1000,
    active: true,
    paused: false,
    stop_loss_percent: 10,
    take_profit_percent: 25,
  };
  const env = {
    LIVE_TRADING_ENABLED: 'true', LIVE_TRADING_CONFIRM: 'CR123456',
    PLAYGO_ENV: 'local',
    PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
    PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890',
  };
  const fetchImpl = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/playgo_real_controls')) return Response.json([control]);
    throw Error(`Unexpected request: ${parsed.pathname}`);
  };
  const results = await placeRealAgentOrders({
    accounts: [realAccount],
    token: 'fixture',
    symbol: 'R_75',
    granularity: 60,
    stopLossPercent: 20,
    takeProfitPercent: 30,
    env,
    fetchImpl,
  });
  assert.equal(results[0].status, 'blocked');
  assert.equal(results[0].reason, 'EXIT_SETTINGS_MISMATCH');
  assert.equal(results[0].automationActive, true);
  assert.equal(control.active, true);
});

test('one-time checks close a contract at its configured loss threshold without buying again', async () => {
  const events = [];
  let control = null;
  const env = {
    LIVE_TRADING_ENABLED: 'true', LIVE_TRADING_CONFIRM: 'CR123456',
    PLAYGO_ENV: 'local',
    PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
    PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890',
  };
  const fetchImpl = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/playgo_real_controls'))
      return Response.json(control ? [control] : []);
    if (parsed.pathname.endsWith('/rpc/playgo_real_configure_control')) {
      control = {
        account_id: realAccount.account_id,
        starting_balance: 1000,
        active: true,
        paused: false,
        stop_loss_percent: 10,
        take_profit_percent: 25,
      };
      return Response.json({ active: true });
    }
    if (parsed.pathname.endsWith('/rpc/playgo_real_stop_control')) {
      control.active = false;
      return Response.json({ active: false });
    }
    if (parsed.pathname.endsWith('/otp'))
      return Response.json({
        data: { url: 'wss://api.derivws.com/trading/v1/options/ws/real?otp=fixture' },
      });
    throw Error(`Unexpected mocked request: ${parsed.pathname}`);
  };
  class ExitThresholdSocket {
    constructor() {
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }

    send(raw) {
      const request = JSON.parse(raw);
      let response;
      if (request.portfolio) {
        response = { req_id: request.req_id, msg_type: 'portfolio', portfolio: { contracts: [{ contract_id: 12345 }] } };
      } else if (request.proposal_open_contract) {
        response = {
          req_id: request.req_id,
          msg_type: 'proposal_open_contract',
          proposal_open_contract: {
            contract_id: 12345,
            is_sold: 0,
            status: 'open',
            profit: -1,
            buy_price: 10,
            underlying_symbol: 'R_75',
          },
        };
      } else if (request.sell) {
        events.push('sell-request');
        response = { req_id: request.req_id, msg_type: 'sell', sell: { sold_for: 9 } };
      } else {
        events.push('unexpected-order-request');
        response = { req_id: request.req_id, msg_type: 'error', error: { code: 'UNEXPECTED' } };
      }
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const results = await placeRealAgentOrders({
    accounts: [realAccount],
    token: 'fixture',
    appId: 'fixture',
    symbol: 'R_75',
    granularity: 60,
    stopLossPercent: 10,
    takeProfitPercent: 25,
    env,
    fetchImpl,
    Socket: ExitThresholdSocket,
  });
  assert.equal(results[0].status, 'exited');
  assert.equal(results[0].closeResults[0].closed, true);
  assert.deepEqual(events, ['sell-request']);
  assert.equal(control.active, false);
});

test('Emergency Agent pauses first, then attempts to close every open contract', async () => {
  const events = [];
  const result = await runEmergencyCheck({
    account: { ...realAccount, balance: 850 },
    control: { starting_balance: 1000 },
    portfolio: {
      contracts: [
        { id: '11', profit: -25 },
        { id: '12', profit: -25 },
      ],
    },
    pause: async () => { events.push('pause'); },
    closeContracts: async ids => {
      events.push('close');
      assert.deepEqual(ids, ['11', '12']);
      return ids.map(contractId => ({ contractId, closed: true }));
    },
  });
  assert.equal(result.status, 'stopped');
  assert.deepEqual(events, ['pause', 'close']);
});

test('real portfolio reads and verifies the stake used by exit thresholds', async () => {
  const portfolio = await readRealPortfolio({
    account: realAccount,
    token: 'fixture',
    fetchImpl: otpFetch,
    Socket: class extends BrokerSocket {
      send(raw) {
        const request = JSON.parse(raw);
        const response = request.portfolio
          ? { req_id: request.req_id, msg_type: 'portfolio', portfolio: { contracts: [{ contract_id: 12345 }] } }
          : {
            req_id: request.req_id,
            msg_type: 'proposal_open_contract',
            proposal_open_contract: {
              contract_id: 12345,
              is_sold: 0,
              status: 'open',
              profit: -1,
              contract_type: 'PUT',
              entry_spot_display_value: '12.3400',
              current_spot: 12.35,
              date_expiry: 1900000000,
              buy_price: 10,
              underlying_symbol: 'R_75',
            },
          };
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
      }
    },
  });
  assert.deepEqual(portfolio.contracts, [
    { id: '12345', symbol: 'R_75', contractType: 'PUT', entrySpot: '12.3400', currentSpot: 12.35, profit: -1, canSell: false, expiryTime: 1900000000, stake: 10 },
  ]);
});

test('real execution migration persists controls and rejects over-limit reservations', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile('backend/deriv_execution/real_execution.sql', 'utf8'));
  await db.exec('set role service_role');

  const configure = (balance, stopLoss, takeProfit) => db.query(
    'select public.playgo_real_configure_control($1,$2,$3,$4) as result',
    ['CR123456', balance, stopLoss, takeProfit],
  );
  assert.equal((await configure(1000, 10, 25)).rows[0].result.active, true);
  assert.deepEqual(
    (await db.query(
      'select starting_balance,stop_loss_percent,take_profit_percent from public.playgo_real_controls where account_id=$1',
      ['CR123456'],
    )).rows[0],
    { starting_balance: '1000', stop_loss_percent: '10', take_profit_percent: '25' },
  );
  await assert.rejects(configure(1000, 0, 25), /INVALID_REAL_AGENT_CONFIGURATION/);

  const record = {
    account_id: 'CR123456',
    idempotency_key: 'a'.repeat(64),
    status: 'reserved',
    symbol: 'R_75',
    contract_type: 'CALL',
    stake: 10,
    duration: 1,
    balance: 1000,
    equity: 1000,
    open_count: 0,
  };
  const reserve = row => db.query(
    'select public.playgo_real_reserve_intent($1) as result',
    [JSON.stringify(row)],
  );
  assert.equal((await reserve({ ...record, open_count: 5 })).rows[0].result.reason, 'OPEN_CONTRACT_LIMIT');
  const first = (await reserve({ ...record, open_count: 4 })).rows[0].result;
  assert.equal(first.accepted, true);
  assert.equal((await reserve({ ...record, idempotency_key: 'b'.repeat(64) })).rows[0].result.reason, 'UNKNOWN_ORDER_STATE');

  await db.exec('reset role; set role authenticated');
  await assert.rejects(
    db.query('select * from public.playgo_real_controls'),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      'select public.playgo_real_configure_control($1,$2,$3,$4)',
      ['CR123456', 1000, 10, 25],
    ),
    /permission denied/,
  );
  await db.exec('reset role; set role service_role');

  const stop = (await reserve({
    ...record,
    idempotency_key: 'c'.repeat(64),
    stake: 8,
    balance: 800,
    equity: 800,
  })).rows[0].result;
  assert.equal(stop.reason, 'DRAWDOWN_LIMIT');
  const control = (await db.query(
    'select active,paused,stop_reason from public.playgo_real_controls where account_id=$1',
    ['CR123456'],
  )).rows[0];
  assert.deepEqual(control, { active: false, paused: true, stop_reason: 'DRAWDOWN_LIMIT' });
});

test('daily analytics counts settled outcomes at Tanzania midnight', async () => {
  const start = Date.parse('2026-11-22T21:00:00Z') / 1000;
  class HistorySocket extends BrokerSocket {
    send(raw) {
      const request = JSON.parse(raw);
      if (request.req_id === 2) assert.equal(request.date_from, String(start));
      const transactions = [[1, 20, start], [2, 0, start + 1], [3, 10, start + 2], [4, 20, start - 1]]
        .map(([transaction_id, sell_price, sell_time]) => ({ transaction_id, buy_price: 10, sell_price, sell_time }));
      const response = { req_id: request.req_id, msg_type: 'profit_table', profit_table: { transactions: request.req_id === 2 ? [] : transactions } };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
    }
  }
  const history = await readRealHistory({
    account: realAccount, token: 'fixture', fetchImpl: otpFetch, Socket: HistorySocket,
    now: () => (start + 60) * 1000,
  });
  assert.deepEqual(history.today, { date: '2026-11-23', wins: 1, losses: 1, total: 3 });
});

test('reports the Deriv proposal rejection code without entering the buy stage', async () => {
  class RejectedProposalSocket extends BrokerSocket {
    send(raw) {
      const request = JSON.parse(raw);
      assert.equal(request.proposal, 1);
      const response = { req_id: request.req_id, error: { code: 'ContractCreationFailure', message: 'broker detail' } };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
    }
  }
  await assert.rejects(executeRealOrder({
    account: realAccount, token: 'fixture', fetchImpl: otpFetch, Socket: RejectedProposalSocket,
    env: { LIVE_TRADING_ENABLED: 'true', LIVE_TRADING_CONFIRM: realAccount.account_id },
    intent: { symbol: 'R_75', contractType: 'CALL', stake: 10, duration: 1, durationUnit: 'm' },
    beforeBuy: () => assert.fail('rejected proposal must never submit a buy'),
  }), { code: 'DERIV_PROPOSAL_REJECTED_ContractCreationFailure' });
});

test('the real order path fails closed without stored qualification even with both keys', async () => {
  const code = { code: 'LIVE_READINESS_NOT_VERIFIED' };
  await assert.rejects(executeRealOrder({
    account: realAccount, token: 'fixture',
    intent: { symbol: 'R_75', contractType: 'CALL', stake: 10, duration: 1, durationUnit: 'm' },
    env: { LIVE_TRADING_ENABLED: 'true', LIVE_TRADING_CONFIRM: realAccount.account_id, PLAYGO_ENV: 'local',
      PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000', PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890' },
    fetchImpl: async url => String(url).includes('playgo_live_qualification') ? Response.json([]) : otpFetch(),
    Socket: BrokerSocket,
    beforeBuy: () => assert.fail('must never submit without verified evidence'),
  }), code);
});

test('explicit kill switch blocks Demo before contacting the broker', async () => {
  await assert.rejects(executeRealOrder({
    account: { ...realAccount, account_type: 'demo' }, token: 'fixture',
    intent: { symbol: 'R_75', contractType: 'CALL', stake: 10, duration: 1, durationUnit: 'm' },
    env: { TRADING_ENABLED: 'false' }, fetchImpl: assert.fail, beforeBuy: assert.fail,
  }), { code: 'TRADING_DISABLED' });
});
