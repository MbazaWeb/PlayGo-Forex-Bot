import { summarizeClosedTrades } from './tradePerformance.js';

const reasons = {
  ORDER_OUTCOME_UNKNOWN: 'Deriv has not confirmed this order. Check open trades before trying again.',
  DRAWDOWN_LIMIT: 'Trading paused because the account reached its loss limit.',
  OPEN_CONTRACT_LIMIT: 'The maximum number of trades is already open.',
  MARKET_ALREADY_OPEN: 'A trade is already open on this market.',
  EXIT_MONITORING: 'Checking open trades.',
  CONTRACT_EXIT_THRESHOLD: 'An open trade reached its exit target.',
  ELEVATED_VOLATILITY: 'Prices were moving too sharply.',
  BREAKOUT_NOT_CONFIRMED: 'The price move was too small to confirm an entry.',
  INVALID_EXIT_SETTINGS: 'Check your stop-loss and take-profit settings.',
  LIVE_TRADING_DISABLED: 'Trading is disabled for this account.',
  EQUITY_UNVERIFIED: 'The bot could not verify the account value.',
  DUPLICATE_INTENT: 'The bot already checked this entry.',
};

export function explainDecision({ status, reason = '', detail = '' } = {}) {
  if (status === 'ordered') return 'Order opened.';
  if (reasons[reason]) return reasons[reason];
  if (reason.startsWith('DERIV_PROPOSAL_REJECTED')) {
    if (/market.*closed/i.test(detail)) return 'This market is closed.';
    if (/duration/i.test(detail)) return 'Deriv declined the selected trade duration.';
    if (/stake|amount/i.test(detail)) return 'Deriv declined the trade amount.';
    return 'Deriv declined the requested trade terms.';
  }
  if (/SIGNAL|INSUFFICIENT/.test(reason)) return 'The signal was too weak to trade.';
  if (/MARKET_DATA/.test(reason)) return 'Reliable market prices were unavailable.';
  if (/AGENT_NOT_|AGENT_PAUSED/.test(reason)) return 'The bot is paused.';
  if (status === 'exited') return 'The bot checked the exit targets.';
  return 'The bot could not confirm the result. Check trade history for an update.';
}

const journalKey = account => 'playgo:decisions:' + account;
export function readDecisions(account) {
  try {
    const rows = JSON.parse(localStorage.getItem(journalKey(account)) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
export function recordDecision(account, market, result) {
  if (!account || !result || (result.accountId && result.accountId !== account)) return;
  const decision = {
    time: Date.now(), market, status: result.status, reason: explainDecision(result),
    strategy: result.strategy, direction: result.contractType, score: result.score,
    contract: result.contractId ? String(result.contractId) : null,
  };
  try { localStorage.setItem(journalKey(account), JSON.stringify([decision, ...readDecisions(account)].slice(0, 1000))); } catch {}
}

export function tradeStats(amounts) {
  const wins = amounts.filter(n => n > 0), losses = amounts.filter(n => n < 0);
  const totals = summarizeClosedTrades(amounts.map(value => ({ value })));
  return { count: amounts.length, wins: wins.length, losses: losses.length,
    flat: amounts.length - wins.length - losses.length, net: totals.net,
    winRate: amounts.length ? wins.length / amounts.length : null,
    lossRate: amounts.length ? losses.length / amounts.length : null,
    avgWin: totals.averageWin,
    avgLoss: totals.averageLoss };
}
