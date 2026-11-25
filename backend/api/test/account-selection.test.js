import assert from 'node:assert/strict';
import test from 'node:test';
import { accountReference, activateAccount, publicAccount } from '../src/account-selection.js';

const accounts = [
  { account_id: 'DOT123456', account_type: 'demo', currency: 'USD', balance: 100 },
  { account_id: 'CR654321', account_type: 'real', currency: 'USD', balance: 50 },
];
const env = {
  PLAYGO_ENV: 'local',
  PLAYGO_LOCAL_REST_URL: 'http://127.0.0.1:3000',
  PLAYGO_LOCAL_WORKER_JWT: 'fixture-worker-token-1234567890',
};

test('real account activation requires confirmation and records a masked audit event', async () => {
  const session = { activeAccountId: null };
  const accountRef = accountReference('fixture-token', 'CR654321');
  let audit;
  const fetchImpl = async (url, options) => {
    assert.match(String(url), /playgo_real_audit$/);
    audit = JSON.parse(options.body);
    return new Response(null, { status: 204 });
  };
  await assert.rejects(
    activateAccount({
      session,
      accounts,
      accountRef,
      token: 'fixture-token',
      env,
      fetchImpl,
    }),
    { code: 'REAL_ACCOUNT_CONFIRMATION_REQUIRED' }
  );
  assert.equal(session.activeAccountId, null);
  assert.equal(audit, undefined);

  const selected = await activateAccount({
    session,
    accounts,
    accountRef,
    token: 'fixture-token',
    confirmReal: true,
    env,
    fetchImpl,
  });
  assert.equal(selected.account_id, 'CR654321');
  assert.equal(session.activeAccountId, 'CR654321');
  assert.deepEqual(audit.event_data, {
    account_reference: '...4321',
    previous_account_type: null,
  });
  assert.equal(publicAccount(selected, 'fixture-token').maskedAccountId, '...4321');
  assert.equal(JSON.stringify(publicAccount(selected, 'fixture-token')).includes('CR654321'), false);
});

test('account switching stays blocked when the current account has an open contract', async () => {
  const session = { activeAccountId: 'DOT123456' };
  let auditWrites = 0;
  class PortfolioSocket {
    constructor() {
      queueMicrotask(() => this.onopen?.());
    }

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
              buy_price: 10,
            },
          };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
    }

    close() {}
  }
  await assert.rejects(
    activateAccount({
      session,
      accounts,
      accountRef: accountReference('fixture-token', 'CR654321'),
      token: 'fixture-token',
      confirmReal: true,
      env,
      Socket: PortfolioSocket,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/otp'))
          return Response.json({ data: { url: 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=fixture' } });
        auditWrites++;
        return new Response(null, { status: 204 });
      },
    }),
    { code: 'ACCOUNT_SWITCH_OPEN_POSITIONS' }
  );
  assert.equal(session.activeAccountId, 'DOT123456');
  assert.equal(auditWrites, 0);
});

test('switching fails closed if the previously selected account is no longer linked', async () => {
  const session = { activeAccountId: 'CR000000' };
  await assert.rejects(
    activateAccount({
      session,
      accounts,
      accountRef: accountReference('fixture-token', 'DOT123456'),
      token: 'fixture-token',
      env,
      fetchImpl: assert.fail,
    }),
    { code: 'ACTIVE_ACCOUNT_UNAVAILABLE' }
  );
  assert.equal(session.activeAccountId, 'CR000000');
});
