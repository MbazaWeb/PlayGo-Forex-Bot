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
export function evaluateLiveGate(trades) {
  const list = Array.isArray(trades) ? trades : [];
  const ordered = list.slice().sort((a, b) => a.settledAt - b.settledAt);
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
  const outOfSample = ordered.slice(outStart);
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
    { id: 'net', label: 'Net P&L after all costs is positive',
      actual: net, passed: net > 0 },
    { id: 'profitFactor', label: `Profit factor at least ${LIVE_GATE.minProfitFactor}`,
      actual: profitFactor, passed: profitFactor !== null && profitFactor >= LIVE_GATE.minProfitFactor },
    { id: 'breakEven', label: 'Win rate above break-even win rate',
      actual: winRate, threshold: breakEven,
      passed: winRate !== null && breakEven !== null && winRate > breakEven },
    { id: 'outOfSample', label: `Most recent ${LIVE_GATE.outOfSampleShare * 100}% of trades (at least ${LIVE_GATE.minOutOfSampleTrades}) are net positive`,
      actual: outOfSampleNet, passed: outOfSample.length >= LIVE_GATE.minOutOfSampleTrades && outOfSampleNet > 0 },
    { id: 'strategy', label: 'Every trade has a recorded strategy',
      actual: strategyRecorded, passed: ordered.length > 0 && strategyRecorded === ordered.length },
    { id: 'reconciled', label: 'Every trade has a broker settlement record',
      actual: reconciled, passed: ordered.length > 0 && reconciled === ordered.length },
  ];
  return {
    passed: checks.every(c => c.passed),
    checks,
    summary: { trades: ordered.length, net, winRate, breakEven, profitFactor, averageWin, averageLoss, weeks: weeks.size },
  };
}
