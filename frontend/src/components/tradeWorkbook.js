import writeXlsxFile from 'write-excel-file';
import { reviewLoss } from './lossReview.js';
import { readDecisions, readContractEvidence, tradeStats } from './tradeReview.js';

const dateTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Dar_es_Salaam', dateStyle: 'short', timeStyle: 'medium' });
const when = ms => ms > 0 && Number.isFinite(new Date(ms).getTime()) ? dateTime.format(ms) : null;
const sheet = rows => rows.map((row, i) => row.map(value => value == null ? null : ({
  value, type: typeof value === 'number' ? Number : String,
  ...(typeof value === 'string' && value.length > 60 && { wrap: true }),
  ...(i === 0 && { fontWeight: 'bold', backgroundColor: '#17435C', color: '#FFFFFF' }),
})));

export async function downloadTradeWorkbook(account, currency, settled, open) {
  const journal = readDecisions(account);
  const evidence = [...journal, ...readContractEvidence(account)].sort((a,b) => a.time - b.time);
  const contractMap = status => new Map(evidence.filter(r => r.status === status && r.contract).map(r => [r.contract, r]));
  const orders = contractMap('ordered'), exits = contractMap('closed');
  const pnl = settled.map(r => Number((r.sell - r.buy).toFixed(8)));
  const s = tradeStats(pnl);
  const pct = n => n == null ? null : Number((100 * n).toFixed(2));
  const summary = [['Account review', 'Value'], ['Account', account], ['Currency', currency],
    ['Exported (EAT)', when(Date.now())], ['Coverage', 'Latest available account settlements (up to 25)'],
    ['Settled trades', s.count], ['Wins', s.wins], ['Losses', s.losses], ['Break-even', s.flat],
    ['Win rate (%)', pct(s.winRate)], ['Loss rate (%)', pct(s.lossRate)], ['Net result', s.net],
    ['Average win', s.avgWin], ['Average loss', s.avgLoss], ['Average per settlement', s.count ? s.net / s.count : null],
    ['Decisions', 'Latest 1,000 decisions on this browser, with a separate history of up to 1,000 contract events.'],
    ['Open trades source', open == null ? 'Snapshot unavailable' : 'Broker portfolio snapshot'],
    ['Loss evidence', 'Settlement amounts come from Deriv. Prices and exit records are shown when available. Blank means unknown.'],
    ['Testing changes', 'Test one change at equal demo stakes on later trades. Compare net return per unit staked, drawdown and trade count against the current rules.']];
  const trades = [['Contract', 'Transaction', 'Settled (EAT)', 'Cost', 'Returned', 'Net', 'Result', 'Market', 'Strategy', 'Direction', 'Score', 'Purchased (EAT)', 'Return on cost (%)', 'Broker contract terms', 'Broker contract code'],
    ...settled.map((r,i) => {
      const d = orders.get(String(r.contractId));
      return [r.contractId, r.id, when(r.settledAt * 1000), r.buy, r.sell, pnl[i], pnl[i] > 0 ? 'Win' : pnl[i] < 0 ? 'Loss' : 'Break-even', d?.market || r.review?.market, d?.strategy || 'Unattributed', d?.direction || r.review?.direction, d?.score, when(r.purchasedAt * 1000), r.buy ? pct(pnl[i] / r.buy) : null, r.terms, r.contractCode];
    })];
  const positions = [['Contract', 'Market', 'Direction', 'Stake', 'Open P&L'], ...(open || []).map(r => [r.id, r.symbol, r.contractType, r.stake, r.profit])];
  const decisions = [['Checked (EAT)', 'Market', 'Status', 'Reason', 'Strategy', 'Direction', 'Score', 'Contract'],
    ...journal.map(r => [when(r.time), r.market, r.status, r.reason, r.strategy, r.direction, r.score, r.contract])];
  const lossRows = [['Contract', 'Transaction', 'Settled (EAT)', 'Market', 'Strategy used', 'Direction', 'Cost', 'Returned', 'Net loss', 'Entry price', 'Exit price', 'Confirmed exit', 'Observed trigger P&L', 'What happened', 'Evidence gaps', 'Next demo test']];
  const signals = [['Contract', 'Market', 'Strategy', 'Entry mode', 'Signal candle (EAT)', 'Duration (minutes)', 'Signal score', 'Signal candle close', 'SMA 20', 'SMA 50', 'RSI 14', 'Momentum (%)', 'Volatility (%)', 'Volatility level', 'Settled net']];
  settled.forEach((trade, index) => {
    const key = String(trade.contractId), order = orders.get(key), exit = exits.get(key), e = order?.entry;
    const market = order?.market ?? trade.review?.market, strategy = order?.strategy || 'Unattributed';
    if (order) signals.push([key, market, strategy, e?.mode, when(e?.signalAt * 1000), e?.durationMinutes, order.score,
      e?.candleClose, e?.sma20, e?.sma50, e?.rsi, e?.momentumPct, e?.volatilityPct, e?.riskLevel, pnl[index]]);
    if (pnl[index] >= 0) return;
    const review = reviewLoss(trade, order, exit);
    lossRows.push([trade.contractId, trade.id, when(trade.settledAt * 1000), market, strategy, order?.direction ?? trade.review?.direction,
      trade.buy, trade.sell, pnl[index], trade.review?.entrySpot, trade.review?.exitSpot, exit?.reason ?? trade.review?.status, exit?.triggerProfit,
      review.observed, review.gaps, review.test]);
  });
  const groups = new Map();
  settled.forEach((trade, index) => {
    const order = orders.get(String(trade.contractId));
    const strategy = order?.strategy || 'Unattributed';
    if (!groups.has(strategy)) groups.set(strategy, []);
    groups.get(strategy).push(pnl[index]);
  });
  const strategies = [['Strategy', 'Settled', 'Win rate (%)', 'Average win', 'Average loss', 'Net', 'Net per trade', 'Wins', 'Losses', 'Review priority']];
  for (const [name, amounts] of groups) {
    const stats = tradeStats(amounts);
    strategies.push([name, stats.count, pct(stats.winRate), stats.avgWin, stats.avgLoss, stats.net, stats.net / stats.count, stats.wins, stats.losses,
      name === 'Unattributed' ? 'Match contract IDs to order records before assessing a strategy.' :
      stats.net < 0 ? 'Review losing entries and exit reasons against winning trades in this group.' : 'Check whether results repeat on later demo trades.']);
  }
  const data = [summary, trades, positions, decisions, strategies, lossRows, signals];
  await writeXlsxFile(data.map(sheet), { sheets: ['Summary', 'Settled trades', 'Open trades', 'Agent decisions', 'Strategy review', 'Loss review', 'Entry evidence'],
    columns: data.map(rows => rows[0].map((_, i) => ({ width: Math.min(85, Math.max(14, ...rows.map(r => String(r[i] ?? '').length + 2))) }))),
    fileName: 'PlayGo-' + account + '-' + when(Date.now()).slice(0,10) + '.xlsx' });
}
