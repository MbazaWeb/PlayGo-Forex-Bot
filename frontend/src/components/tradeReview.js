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
    entry: result.entry, strategy: result.strategy, direction: result.contractType, score: result.score,
    contract: result.contractId ? String(result.contractId) : null,
  };
  const exits = (result.closeResults || []).filter(row => row.closed === true).map(row => {
    const trigger = result.exitContracts?.find(item => String(item.contractId) === String(row.contractId));
    const reason = result.reason === 'MANUAL_CLOSE' ? 'User closed the trade'
      : result.reason === 'DRAWDOWN_LIMIT' ? 'Account loss limit triggered'
      : result.reason === 'CONTRACT_EXIT_THRESHOLD' && trigger ? (trigger.profit < 0 ? 'Stop-loss triggered' : 'Profit target triggered') : 'Bot close confirmed';
    return { time: decision.time, status: 'closed', contract: String(row.contractId), reason, triggerProfit: trigger?.profit };
  });
  const events = [decision, ...exits];
  const linked = events.filter(row => row.contract);
  try {
    if (linked.length) localStorage.setItem(journalKey(account) + ':contracts', JSON.stringify([...linked, ...readContractEvidence(account)].slice(0, 1000)));
  } catch {}
  try { localStorage.setItem(journalKey(account), JSON.stringify([...events, ...readDecisions(account)].slice(0, 1000))); } catch {}
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

export function readContractEvidence(account) {
  try {
    const rows = JSON.parse(localStorage.getItem(journalKey(account) + ':contracts') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
