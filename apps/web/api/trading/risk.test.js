import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTrade, liveTradingAllowed } from './risk.js';
const input = () => ({
 intent: { idempotencyKey: 'unique_demo_order_123456', stake: 0.5, contractType: 'CALL', symbol: 'R_100', duration: 5, durationUnit: 'm' },
 account: { type: 'demo', balance: 100, currency: 'USD' },
 state: { killSwitch: false, reconciliationHealthy: true, hasUnknownOrders: false, dailyRealizedPnl: 0, openContracts: 0, tradesToday: 0, consecutiveLosses: 0, lastTradeAt: 0 }
});
test('accepts bounded demo intent', () => assert.equal(assessTrade(input()).allowed, true));
test('rejects real accounts', () => { const i=input(); i.account.type='real'; assert.equal(assessTrade(i).reason,'REAL_ACCOUNT_DISABLED'); });
test('rejects unknown order state', () => { const i=input(); i.state.hasUnknownOrders=true; assert.equal(assessTrade(i).allowed,false); });
test('rejects kill switch', () => { const i=input(); i.state.killSwitch=true; assert.equal(assessTrade(i).allowed,false); });
test('rejects missing reconciliation', () => { const i=input(); i.state.reconciliationHealthy=false; assert.equal(assessTrade(i).allowed,false); });
test('rejects stake beyond cap', () => { const i=input(); i.intent.stake=2; assert.equal(assessTrade(i).allowed,false); });
test('real execution is always disabled', () => assert.equal(liveTradingAllowed(),false));
