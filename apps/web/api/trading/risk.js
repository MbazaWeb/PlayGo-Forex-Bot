// PlayGo Deriv execution policy. Server-only; fail closed.
export const DEFAULT_LIMITS = Object.freeze({
  maxStake: 1, maxDailyLoss: 5, maxOpenContracts: 1,
  maxTradesPerDay: 10, maxConsecutiveLosses: 3,
  minSecondsBetweenTrades: 60
});
const finite = n => typeof n === 'number' && Number.isFinite(n);
export function assessTrade({ intent, account, state, limits = DEFAULT_LIMITS, now = Date.now() }) {
  const reject = reason => ({ allowed: false, reason });
  if (!intent || !account || !state) return reject('MISSING_CONTEXT');
  if (account.type !== 'demo') return reject('REAL_ACCOUNT_DISABLED');
  if (state.killSwitch !== false) return reject('KILL_SWITCH');
  if (state.reconciliationHealthy !== true) return reject('RECONCILIATION_UNHEALTHY');
  if (state.hasUnknownOrders !== false) return reject('UNKNOWN_ORDER_STATE');
  if (typeof intent.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(intent.idempotencyKey)) return reject('INVALID_IDEMPOTENCY_KEY');
  if (!finite(intent.stake) || intent.stake <= 0 || intent.stake > limits.maxStake) return reject('STAKE_LIMIT');
  if (!finite(account.balance) || account.balance < intent.stake) return reject('INSUFFICIENT_BALANCE');
  if (!finite(state.dailyRealizedPnl) || state.dailyRealizedPnl <= -limits.maxDailyLoss) return reject('DAILY_LOSS_LIMIT');
  if (!Number.isSafeInteger(state.openContracts) || state.openContracts >= limits.maxOpenContracts) return reject('OPEN_CONTRACT_LIMIT');
  if (!Number.isSafeInteger(state.tradesToday) || state.tradesToday >= limits.maxTradesPerDay) return reject('DAILY_TRADE_LIMIT');
  if (!Number.isSafeInteger(state.consecutiveLosses) || state.consecutiveLosses >= limits.maxConsecutiveLosses) return reject('LOSS_STREAK_LIMIT');
  if (!finite(state.lastTradeAt) || now - state.lastTradeAt < limits.minSecondsBetweenTrades * 1000) return reject('COOLDOWN');
  if (!['CALL','PUT'].includes(intent.contractType)) return reject('UNSUPPORTED_CONTRACT');
  if (typeof intent.symbol !== 'string' || !/^[A-Z0-9_]{2,30}$/.test(intent.symbol)) return reject('INVALID_SYMBOL');
  if (!Number.isSafeInteger(intent.duration) || intent.duration < 1 || intent.duration > 60 || intent.durationUnit !== 'm') return reject('INVALID_DURATION');
  if (typeof account.currency !== 'string' || !/^[A-Z]{3}$/.test(account.currency)) return reject('INVALID_CURRENCY');
  return { allowed: true, reason: 'DEMO_POLICY_PASSED' };
}
export function liveTradingAllowed() {
  // Deliberately hard disabled until a separate reviewed real-account release.
  return false;
}
