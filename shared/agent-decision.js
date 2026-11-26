const DATA_REASONS = new Set([
  'DUPLICATE_MARKET_DATA',
  'INSUFFICIENT',
  'INVALID',
  'MARKET_DATA_GAP',
  'STALE_MARKET_DATA',
  'UNALIGNED_MARKET_DATA',
]);

const RISK_REASONS = new Set([
  'DAILY_HISTORY_INCOMPLETE',
  'DAILY_LOSS_LIMIT',
  'DRAWDOWN_LIMIT',
  'EQUITY_UNVERIFIED',
  'LOSS_STREAK_COOLDOWN',
  'OPEN_CONTRACT_LIMIT',
  'OPEN_EXPOSURE_LIMIT',
  'STAKE_BELOW_MINIMUM',
  'STAKE_LIMIT',
]);

export function decisionStage(status, reason) {
  if (status === 'ordered' || reason === 'ORDER_OUTCOME_UNKNOWN') return 'Buy confirmation';
  if (status === 'exited' || reason === 'EXIT_MONITORING' || reason === 'EARLY_SALE_UNAVAILABLE')
    return 'Exit monitoring';
  if (DATA_REASONS.has(reason) || reason?.startsWith('MARKET_DATA_')) return 'Market data';
  if (reason === 'WEAK_SIGNAL' || reason === 'NO_QUALIFYING_SIGNAL' ||
      reason === 'ELEVATED_VOLATILITY' || reason === 'BREAKOUT_NOT_CONFIRMED')
    return 'Strategy';
  if (reason === 'DERIV_MARKET_UNAVAILABLE' || reason?.startsWith('DERIV_CONTRACT') ||
      reason === 'INVALID_CONTRACTS_RESPONSE')
    return 'Market eligibility';
  if (reason?.startsWith('DERIV_PROPOSAL_REJECTED')) return 'Broker proposal';
  if (RISK_REASONS.has(reason) || reason?.startsWith('DAILY_') || reason?.startsWith('DRAWDOWN_'))
    return 'Risk';
  if (reason === 'MARKET_ALREADY_OPEN' || reason === 'POSITION_CHECK')
    return 'Position check';
  return 'Agent control';
}

export function decisionNextAction(status, reason) {
  if (status === 'ordered')
    return 'Monitor this broker-confirmed contract until settlement.';
  if (reason === 'ORDER_OUTCOME_UNKNOWN')
    return 'Check Deriv open positions and reconciliation before allowing another order.';
  if (reason === 'MARKET_DATA_GAP')
    return 'Wait for at least 50 consecutive closed candles; inspect the feed if the gap persists.';
  if (reason === 'INSUFFICIENT')
    return 'Wait until 50 recent consecutive closed candles are available.';
  if (reason === 'STALE_MARKET_DATA' || reason === 'MARKET_DATA_TIMEOUT' ||
      reason === 'MARKET_DATA_UNAVAILABLE' || reason === 'MARKET_DATA_DISCONNECTED')
    return 'Retry when fresh market data is available; do not lower validation requirements.';
  if (reason === 'DUPLICATE_MARKET_DATA' || reason === 'INVALID' ||
      reason === 'UNALIGNED_MARKET_DATA')
    return 'Skip this feed and retry after new data; inspect diagnostics if it repeats.';
  if (reason === 'WEAK_SIGNAL' || reason === 'NO_QUALIFYING_SIGNAL' ||
      reason === 'ELEVATED_VOLATILITY' || reason === 'BREAKOUT_NOT_CONFIRMED')
    return 'Wait for the strategy conditions to qualify; do not weaken the signal threshold.';
  if (reason === 'DERIV_MARKET_UNAVAILABLE' || reason?.startsWith('DERIV_CONTRACT') ||
      reason === 'INVALID_CONTRACTS_RESPONSE')
    return 'Skip this market and scan one with the requested contract and duration available.';
  if (reason?.startsWith('DERIV_PROPOSAL_REJECTED'))
    return 'No buy was submitted; record the broker code and try another eligible market.';
  if (reason === 'DAILY_LOSS_LIMIT' || reason === 'DRAWDOWN_LIMIT')
    return 'Keep trading paused and review the risk control before the next trading period.';
  if (reason === 'LOSS_STREAK_COOLDOWN')
    return 'Wait for the configured loss-streak cooldown to expire.';
  if (reason === 'DAILY_HISTORY_INCOMPLETE')
    return 'Wait for complete settlement history; entries remain blocked until it is verified.';
  if (reason === 'OPEN_CONTRACT_LIMIT' || reason === 'OPEN_EXPOSURE_LIMIT')
    return 'Wait for an open contract to settle or exposure to fall below the configured limit.';
  if (reason === 'EARLY_SALE_UNAVAILABLE')
    return 'Keep monitoring; Deriv is not offering an early sale for this contract.';
  if (status === 'watching' && reason === 'MARKET_ALREADY_OPEN')
    return 'Monitor the existing contract instead of opening another on this market.';
  return 'Review the account and market diagnostics before the next scan.';
}

export function describeAgentDecision({
  status,
  reason = null,
  symbol = null,
  granularity = null,
  observedAt = new Date().toISOString(),
}) {
  return {
    stage: decisionStage(status, reason),
    nextAction: decisionNextAction(status, reason),
    symbol,
    granularity,
    observedAt,
  };
}
