// Live-trading readiness gate. Pure functions only; used by the backend before
// enabling real orders and by the trade report to show the verdict.
// Thresholds are fixed here on purpose: lowering them requires a code review.
export const LIVE_GATE = Object.freeze({
  minSettledTrades: 500,
  minDistinctWeeks: 3,
  maxShareOnSingleDay: 0.5,
  minProfitFactor: 1.2,
  outOfSampleShare: 0.3,
  minOutOfSampleTrades: 100,
});

// Tanzania (EAT) is UTC+03:00 year-round.
const EAT_OFFSET_MS = 3 * 3600 * 1000;

export function eatDayKey(unixSeconds) {
  return new Date(unixSeconds * 1000 + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

// Week starts Monday (EAT). Returns the Monday's date key.
export function eatWeekKey(unixSeconds) {
  const local = new Date(unixSeconds * 1000 + EAT_OFFSET_MS);
  const weekday = local.getUTCDay() || 7;
  return new Date(local.getTime() - (weekday - 1) * 86400000).toISOString().slice(0, 10);
}

// Break-even win rate for a fixed stake, given average win and average loss (both positive magnitudes).
export function breakEvenWinRate(averageWin, averageLoss) {
  if (!(averageWin > 0) || !(averageLoss > 0)) return null;
  return averageLoss / (averageWin + averageLoss);
}

// trades: [{ settledAt: unix seconds, buy: number, sell: number, strategy: string|null, reconciled: boolean }]
export function evaluateLiveGate(trades, { verified = false, holdoutStart = null } = {}) {
  const list = (Array.isArray(trades) ? trades : []).filter(t =>
    Number.isSafeInteger(t?.settledAt) && t.settledAt > 0 && t.settledAt < 1e11 &&
    Number.isFinite(t.buy) && t.buy >= 0 && Number.isFinite(t.sell) && t.sell >= 0);
  const validEvidence = verified && list.length === trades.length && Number.isSafeInteger(holdoutStart) &&
    list.every(t => typeof t.tradeId === 'string' && t.tradeId && typeof t.strategy === 'string' &&
      t.strategy.trim() && typeof t.signal === 'string' && t.signal.trim() && t.reconciled === true &&
      Number.isFinite(t.costs) && t.costs >= 0) && new Set(list.map(t => t.tradeId)).size === list.length;
  const ordered = (validEvidence ? list.map(t => ({ ...t, buy: t.buy + t.costs })) : list).sort((a, b) => a.settledAt - b.settledAt);
  const net = ordered.reduce((sum, t) => sum + (t.sell - t.buy), 0);
  const wins = ordered.filter(t => t.sell > t.buy);
  const losses = ordered.filter(t => t.sell < t.buy);
  const grossWin = wins.reduce((s, t) => s + (t.sell - t.buy), 0);
  const grossLoss = -losses.reduce((s, t) => s + (t.sell - t.buy), 0);
  const averageWin = wins.length ? grossWin / wins.length : null;
  const averageLoss = losses.length ? grossLoss / losses.length : null;
  const winRate = ordered.length ? wins.length / ordered.length : null;
  const breakEven = breakEvenWinRate(averageWin, averageLoss);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;
  const weeks = new Set(ordered.map(t => eatWeekKey(t.settledAt)));
  const dayCounts = new Map();
  for (const t of ordered) dayCounts.set(eatDayKey(t.settledAt), (dayCounts.get(eatDayKey(t.settledAt)) || 0) + 1);
  const largestDayShare = ordered.length ? Math.max(...dayCounts.values()) / ordered.length : null;
  const outStart = Math.floor(ordered.length * (1 - LIVE_GATE.outOfSampleShare));
  const outOfSample = validEvidence ? ordered.filter(t => t.settledAt >= holdoutStart) : ordered.slice(outStart);
  const holdoutWins = outOfSample.filter(t => t.sell > t.buy);
  const holdoutLosses = outOfSample.filter(t => t.sell < t.buy);
  const holdoutGains = holdoutWins.reduce((sum, t) => sum + t.sell - t.buy, 0);
  const holdoutLoss = holdoutLosses.reduce((sum, t) => sum + t.buy - t.sell, 0);
  const holdoutBreakEven = breakEvenWinRate(holdoutGains / holdoutWins.length, holdoutLoss / holdoutLosses.length);
  const outOfSampleNet = outOfSample.reduce((s, t) => s + (t.sell - t.buy), 0);
  const strategyRecorded = ordered.filter(t => t.strategy).length;
  const reconciled = ordered.filter(t => t.reconciled === true).length;

  const checks = [
    { id: 'sample', label: `At least ${LIVE_GATE.minSettledTrades} settled trades`,
      actual: ordered.length, passed: ordered.length >= LIVE_GATE.minSettledTrades },
    { id: 'weeks', label: `Trades across at least ${LIVE_GATE.minDistinctWeeks} separate weeks`,
      actual: weeks.size, passed: weeks.size >= LIVE_GATE.minDistinctWeeks },
    { id: 'sessions', label: `No single day holds more than ${LIVE_GATE.maxShareOnSingleDay * 100}% of trades`,
      actual: largestDayShare, passed: largestDayShare !== null && largestDayShare <= LIVE_GATE.maxShareOnSingleDay },
    { id: 'net', label: 'Verified after-cost net P&L is positive',
      actual: validEvidence ? net : null, passed: validEvidence && net > 0 },
    { id: 'profitFactor', label: `Profit factor at least ${LIVE_GATE.minProfitFactor}`,
      actual: profitFactor, passed: profitFactor !== null && profitFactor >= LIVE_GATE.minProfitFactor },
    { id: 'breakEven', label: 'Win rate above break-even win rate',
      actual: winRate, threshold: breakEven,
      passed: winRate !== null && breakEven !== null && winRate > breakEven },
    { id: 'outOfSample', label: 'Verified holdout has positive net P&L, sufficient trades and predictive win rate',
      actual: validEvidence ? outOfSampleNet : null,
      passed: validEvidence && outOfSample.length >= LIVE_GATE.minOutOfSampleTrades &&
        outOfSample.length < ordered.length && outOfSampleNet > 0 && holdoutLoss > 0 &&
        holdoutGains / holdoutLoss >= LIVE_GATE.minProfitFactor && holdoutBreakEven !== null &&
        holdoutWins.length / outOfSample.length > holdoutBreakEven },
    { id: 'strategy', label: 'Every trade has a recorded strategy',
      actual: strategyRecorded, passed: ordered.length > 0 && strategyRecorded === ordered.length },
    { id: 'reconciled', label: 'Every trade has a verified broker reconciliation',
      actual: reconciled, passed: ordered.length > 0 && reconciled === ordered.length },
  ];
  return {
    passed: validEvidence && checks.every(c => c.passed),
    checks,
    summary: { trades: ordered.length, net, winRate, breakEven, profitFactor, averageWin, averageLoss, weeks: weeks.size },
  };
}
