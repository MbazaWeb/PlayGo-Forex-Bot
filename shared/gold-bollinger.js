const period = 20;
export const GOLD_SIGNAL_BARS = period + 1;

export function bollingerBands(closes) {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  if (window.some(price => !Number.isFinite(price) || price <= 0)) return null;
  const average = window.reduce((sum, price) => sum + price, 0) / period;
  const deviation = Math.sqrt(window.reduce((sum, price) => sum + (price - average) ** 2, 0) / period);
  return { average, deviation, zone: deviation ? (window.at(-1) - average) / deviation : 0 };
}

export function goldSignals(closes) {
  const previous = bollingerBands(closes.slice(0, -1));
  const bands = bollingerBands(closes);
  if (!previous || !bands) return null;
  const before = previous.zone;
  const now = bands.zone;
  return {
    bands,
    trend: before <= 1 && now > 1 ? 1 : before >= -1 && now < -1 ? -1 : 0,
    reversion: before <= -2 && now > -2 && now < 0 ? 1 : before >= 2 && now < 2 && now > 0 ? -1 : 0,
  };
}

export function goldExit(strategy, direction, zone) {
  const signed = direction * zone;
  return strategy === 'trend' ? signed <= 0 : signed >= 0 || signed <= -2;
}
