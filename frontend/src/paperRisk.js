export const PAPER_LIMITS = Object.freeze({
  maxOrderNotional: 1000,
  maxTotalNotional: 3000,
  maxOpenPositions: 5,
  maxDailyRealizedLoss: 200,
});

function todayUTC(now) {
  return now.toISOString().slice(0, 10);
}

export function paperRisk(ledger, order, now = new Date()) {
  if (!ledger || typeof ledger !== 'object') return 'Paper ledger unavailable';
  const { price, units } = order || {};

  if (ledger.halted) return 'Paper trading paused by emergency stop';
  if (!Number.isFinite(price) || price <= 0) return 'Enter a positive price';
  if (!Number.isSafeInteger(units) || units <= 0) return 'Units must be a positive whole number';

  const notional = price * units;
  if (!Number.isFinite(notional)) return 'Invalid notional';
  if (notional > PAPER_LIMITS.maxOrderNotional)
    return `Order exceeds $${PAPER_LIMITS.maxOrderNotional.toLocaleString()} notional limit`;

  if (!Number.isFinite(ledger.cash) || notional > ledger.cash) return 'Insufficient paper cash';
  if (!Array.isArray(ledger.positions)) return 'Paper ledger corrupted';
  if (ledger.positions.length >= PAPER_LIMITS.maxOpenPositions)
    return `Maximum ${PAPER_LIMITS.maxOpenPositions} open positions`;

  const exposure = ledger.positions.reduce((sum, x) => {
    const u = Number(x?.units);
    const e = Number(x?.entry);
    return sum + (Number.isFinite(u) && Number.isFinite(e) ? u * e : 0);
  }, 0);

  if (exposure + notional > PAPER_LIMITS.maxTotalNotional)
    return `Total paper exposure exceeds $${PAPER_LIMITS.maxTotalNotional.toLocaleString()}`;

  const today = todayUTC(now);
  const realized = (ledger.history || [])
    .filter((x) => typeof x?.closedAt === 'string' && x.closedAt.slice(0, 10) === today)
    .reduce((sum, x) => sum + (Number.isFinite(x.pnl) ? x.pnl : 0), 0);

  if (realized <= -PAPER_LIMITS.maxDailyRealizedLoss)
    return 'Daily realized loss limit reached (UTC)';

  return null;
}