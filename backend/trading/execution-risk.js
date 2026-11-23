export const MAX_STAKE_PERCENT = 0.01;
export const MAX_OPEN_CONTRACTS = 5; // matches docs/RISK_CONTROLS_REVIEW.md
export const MAX_DAILY_LOSS_PERCENT = 5; // of starting balance, resets at 00:00 EAT
export const MAX_CONSECUTIVE_LOSSES = 3;
export const LOSS_STREAK_COOLDOWN_SECONDS = 1800;
const EAT_OFFSET_SECONDS = 3 * 3600;
export const MAX_DRAWDOWN_PERCENT = 0.20;
export const SIGNAL_THRESHOLD = 75;
export const MAX_STOP_LOSS_PERCENT_OF_STAKE = 100;
export const MAX_TAKE_PROFIT_PERCENT_OF_STAKE = 10000;

const finitePositive = value => Number.isFinite(value) && value > 0;

export function validExitSettings(stopLossPercent, takeProfitPercent) {
  return finitePositive(stopLossPercent) &&
    stopLossPercent <= MAX_STOP_LOSS_PERCENT_OF_STAKE &&
    finitePositive(takeProfitPercent) &&
    takeProfitPercent <= MAX_TAKE_PROFIT_PERCENT_OF_STAKE;
}

export function contractsAtExitThresholds(contracts, stopLossPercent, takeProfitPercent) {
  if (!Array.isArray(contracts) || !validExitSettings(stopLossPercent, takeProfitPercent))
    return [];
  return contracts.filter(contract => {
    const stake = Number(contract?.stake);
    const profit = Number(contract?.profit);
    if (!finitePositive(stake) || !Number.isFinite(profit)) return false;
    const lossThreshold = stake * stopLossPercent / 100;
    const profitThreshold = stake * takeProfitPercent / 100;
    return Number.isFinite(lossThreshold) && Number.isFinite(profitThreshold) &&
      (profit <= -lossThreshold || profit >= profitThreshold);
  });
}

export function calculateStake(balance, currency) {
  if (!finitePositive(balance)) throw Error('INVALID_ACCOUNT_BALANCE');
  const scale = currency === 'USD' ? 100 : 1e8;
  return Math.floor(balance * MAX_STAKE_PERCENT * scale) / scale;
}

export function evaluateEmergencyStop({ startingBalance, balance, openProfit }) {
  if (![startingBalance, balance, openProfit].every(Number.isFinite) || startingBalance <= 0 || balance < 0)
    return { verified: false, stopped: false, reason: 'EQUITY_UNVERIFIED' };
  const equity = balance + openProfit;
  if (!Number.isFinite(equity) || equity < 0)
    return { verified: false, stopped: false, reason: 'EQUITY_UNVERIFIED' };
  const floor = startingBalance * (1 - MAX_DRAWDOWN_PERCENT);
  return {
    verified: true,
    stopped: equity <= floor,
    equity,
    floor,
    drawdownPercent: Math.max(0, (startingBalance - equity) / startingBalance * 100),
  };
}

export function qualifyingDirection(analysis) {
  if (analysis?.status !== 'ready' || analysis.confluenceScore < SIGNAL_THRESHOLD)
    return null;
  if (analysis.direction === 'bullish') return 'CALL';
  if (analysis.direction === 'bearish') return 'PUT';
  return null;
}

export function startOfEatDay(epochSeconds) {
  return Math.floor((epochSeconds + EAT_OFFSET_SECONDS) / 86400) * 86400 - EAT_OFFSET_SECONDS;
}

// transactions: newest first, [{ buy, sell, settledAt }] with settledAt in unix seconds.
// Halts only while the streak is recent, so the bot cannot stay halted forever without trading.
export function consecutiveLossHalt(transactions, nowEpoch) {
  let run = 0;
  let newestLossAt = null;
  for (const row of transactions) {
    if (!(Number(row.sell) < Number(row.buy))) break;
    run++;
    if (newestLossAt === null) newestLossAt = Number(row.settledAt);
  }
  return run >= MAX_CONSECUTIVE_LOSSES && Number.isFinite(newestLossAt) &&
    nowEpoch - newestLossAt < LOSS_STREAK_COOLDOWN_SECONDS;
}

// complete is false when the fetched page may not reach the start of the EAT day.
export function dailyRiskState(transactions, { nowEpoch, fetchLimit, startingBalance }) {
  const dayStart = startOfEatDay(nowEpoch);
  const oldest = transactions.length ? Number(transactions[transactions.length - 1].settledAt) : null;
  const complete = transactions.length < fetchLimit || (Number.isFinite(oldest) && oldest < dayStart);
  const todayNet = transactions
    .filter(row => Number(row.settledAt) >= dayStart)
    .reduce((sum, row) => sum + (Number(row.sell) - Number(row.buy)), 0);
  const limit = startingBalance > 0 ? -startingBalance * MAX_DAILY_LOSS_PERCENT / 100 : null;
  return { complete, todayNet, breached: complete && limit !== null && todayNet <= limit };
}
