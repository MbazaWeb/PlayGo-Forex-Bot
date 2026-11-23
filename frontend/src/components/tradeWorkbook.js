import writeXlsxFile from 'write-excel-file';
import { readDecisions, tradeStats } from './tradeReview.js';

const dateTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Dar_es_Salaam', dateStyle: 'short', timeStyle: 'medium' });
const when = ms => ms > 0 && Number.isFinite(new Date(ms).getTime()) ? dateTime.format(ms) : null;
const sheet = rows => rows.map((row, i) => row.map(value => value == null ? null : ({
  value, type: typeof value === 'number' ? Number : String,
  ...(i === 0 && { fontWeight: 'bold', backgroundColor: '#17435C', color: '#FFFFFF' }),
})));

export async function downloadTradeWorkbook(account, currency, settled, open) {
  const journal = readDecisions(account);
  const orders = new Map(journal.filter(r => r.contract).map(r => [r.contract, r]));
  const pnl = settled.map(r => Number((r.sell - r.buy).toFixed(8)));
  const s = tradeStats(pnl);
  const pct = n => n == null ? null : Number((100 * n).toFixed(2));
  const summary = [['Account review', 'Value'], ['Account', account], ['Currency', currency],
    ['Exported (EAT)', when(Date.now())], ['Coverage', 'Latest available account settlements (up to 25)'],
    ['Settled trades', s.count], ['Wins', s.wins], ['Losses', s.losses], ['Break-even', s.flat],
    ['Win rate (%)', pct(s.winRate)], ['Loss rate (%)', pct(s.lossRate)], ['Net result', s.net],
    ['Average win', s.avgWin], ['Average loss', s.avgLoss], ['Average per settlement', s.count ? s.net / s.count : null],
    ['Decisions', 'Latest 1,000 entry decisions recorded on this browser. Blank fields mean unavailable.']];
  const trades = [['Contract', 'Transaction', 'Settled (EAT)', 'Cost', 'Returned', 'Net', 'Result', 'Market', 'Strategy', 'Direction', 'Score'],
    ...settled.map((r,i) => {
      const d = orders.get(String(r.contractId));
      return [r.contractId, r.id, when(r.settledAt * 1000), r.buy, r.sell, pnl[i], pnl[i] > 0 ? 'Win' : pnl[i] < 0 ? 'Loss' : 'Break-even', d?.market, d?.strategy, d?.direction, d?.score];
    })];
  const positions = [['Contract', 'Market', 'Direction', 'Stake', 'Open P&L'], ...open.map(r => [r.id, r.symbol, r.contractType, r.stake, r.profit])];
  const decisions = [['Checked (EAT)', 'Market', 'Status', 'Reason', 'Strategy', 'Direction', 'Score', 'Contract'],
    ...journal.map(r => [when(r.time), r.market, r.status, r.reason, r.strategy, r.direction, r.score, r.contract])];
  const groups = new Map();
  settled.forEach((trade, index) => {
    const order = orders.get(String(trade.contractId));
    const strategy = order?.strategy || 'Unattributed';
    if (!groups.has(strategy)) groups.set(strategy, []);
    groups.get(strategy).push(pnl[index]);
  });
  const strategies = [['Strategy', 'Settled', 'Win rate (%)', 'Average win', 'Average loss', 'Net', 'Net per trade']];
  for (const [name, amounts] of groups) {
    const stats = tradeStats(amounts);
    strategies.push([name, stats.count, pct(stats.winRate), stats.avgWin, stats.avgLoss, stats.net, stats.net / stats.count]);
  }
  const data = [summary, trades, positions, decisions, strategies];
  await writeXlsxFile(data.map(sheet), { sheets: ['Summary', 'Settled trades', 'Open trades', 'Agent decisions', 'Strategy review'],
    columns: data.map(rows => rows[0].map((_, i) => ({ width: Math.min(85, Math.max(14, ...rows.map(r => String(r[i] ?? '').length + 2))) }))),
    fileName: 'PlayGo-' + account + '-' + when(Date.now()).slice(0,10) + '.xlsx' });
}
