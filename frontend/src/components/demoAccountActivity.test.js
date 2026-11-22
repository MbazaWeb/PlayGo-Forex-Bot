import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDemoActivity } from './demoAccountActivity.js';

const accountId = 'DEMO123';
const fixtures = () => ({
  accountId,
  accounts: [{ account_id: accountId, account_type: 'demo', balance: '250.00', currency: 'USD' }],
  portfolio: { accountId, contracts: [{ id: '42', symbol: 'frxEURUSD' }], observedAt: '2026-11-22T00:00:00.000Z' },
  history: { accountId, transactions: [{ id: '7', buy: '1.00', sell: '1.25' }], observedAt: '2026-11-22T00:00:00.000Z' },
});

test('normalizes account-scoped Deriv demo activity without inventing account data', () => {
  const result = normalizeDemoActivity(fixtures());
  assert.equal(result.account.balance, '250.00');
  assert.deepEqual(result.contracts, [{ id: '42', symbol: 'frxEURUSD' }]);
  assert.deepEqual(result.transactions, [{ id: '7', buy: '1.00', sell: '1.25' }]);
});

test('rejects real accounts and activity belonging to another account', () => {
  const input = fixtures();
  input.accounts[0].account_type = 'real';
  assert.throws(() => normalizeDemoActivity(input), /DEMO_ACCOUNT_REQUIRED/);

  const otherAccount = fixtures();
  otherAccount.history.accountId = 'OTHER123';
  assert.throws(() => normalizeDemoActivity(otherAccount), /INVALID_API_RESPONSE/);
});

test('rejects malformed or missing trade amounts rather than displaying zero', () => {
  const input = fixtures();
  input.history.transactions[0].buy = '';
  assert.throws(() => normalizeDemoActivity(input), /INVALID_API_RESPONSE/);
});
