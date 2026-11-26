import { analyzeCandles, automaticEntryBlock } from './agent-analysis.js';

// Both the preview and the execution agent use the same broker bars in arrival order.
export function closedMarketBars(rows, granularity, nowMs) {
  if (!Array.isArray(rows) || !Number.isInteger(granularity) || granularity <= 0) return [];
  const currentStart = Math.floor(nowMs / 1000 / granularity) * granularity;
  return rows.filter(row => row && (Number(row.epoch) < currentStart || Number(row.epoch) >= currentStart + granularity)).map(row => ({
    epoch: Number(row?.epoch),
    open: Number(row?.open),
    high: Number(row?.high),
    low: Number(row?.low),
    close: Number(row?.close),
  }));
}

export function marketIntegrityBlock(candles, granularity, nowMs, minimumBars = 50) {
  if (!Array.isArray(candles) || !Number.isInteger(granularity) || granularity <= 0 || !Number.isFinite(nowMs)) return 'INVALID';
  const recent = candles;
  if (recent.length < minimumBars) return 'INSUFFICIENT';
  const nowSeconds = nowMs / 1000;
  if (!Number.isFinite(recent.at(-1)?.epoch)) return 'INVALID';
  if (recent.at(-1).epoch + granularity > nowSeconds) return 'UNALIGNED_MARKET_DATA';
  if (nowSeconds - recent.at(-1).epoch > granularity * 2) return 'STALE_MARKET_DATA';
  const seen = new Set();
  for (let index = 0; index < recent.length; index++) {
    const epoch = recent[index]?.epoch;
    if (!Number.isSafeInteger(epoch) || epoch <= 0) return 'INVALID';
    if (epoch + granularity > nowSeconds) return 'UNALIGNED_MARKET_DATA';
    if (seen.has(epoch)) return 'DUPLICATE_MARKET_DATA';
    seen.add(epoch);
  }
  if (recent.some((row, index) => index && row.epoch - recent[index - 1].epoch !== granularity))
    return 'MARKET_DATA_GAP';
  return null;
}

export function reviewMarket(candles, granularity, nowMs, automatic) {
  // Broker history can cross an overnight market closure. Review a recent
  // continuous window rather than rejecting an otherwise current setup.
  const recent = Array.isArray(candles) ? candles.slice(-60) : candles;
  const dataBlock = marketIntegrityBlock(recent, granularity, nowMs);
  const badPrice = Array.isArray(recent) && recent.some(bar => !bar || ![bar.open, bar.high, bar.low, bar.close]
    .every(price => Number.isFinite(price) && price > 0) ||
    bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close));
  const reason = dataBlock || (badPrice ? 'INVALID' : null);
  if (reason) return { status: 'blocked', block: reason, bars: Array.isArray(recent) ? recent.length : 0 };

  const analysis = analyzeCandles(recent, granularity);
  let block = automatic ? automaticEntryBlock(analysis) : analysis.direction ? null : 'NO_QUALIFYING_SIGNAL';
  let strategy = automatic ? 'Trend + momentum' : 'Manual rules';
  if (automatic && analysis.volatilityRank < 0.2) {
    strategy = 'Low-volatility breakout';
    const prior = recent.slice(-11, -1);
    const breakout = analysis.direction === 'bullish'
      ? analysis.last.close > Math.max(...prior.map(bar => bar.high))
      : analysis.direction === 'bearish' && analysis.last.close < Math.min(...prior.map(bar => bar.low));
    if (!block && (analysis.confluenceScore < 90 || !breakout)) block = 'BREAKOUT_NOT_CONFIRMED';
  }
  return { ...analysis, strategy, block };
}

// Only these non-account fields are exposed in the per-market scan details.
export function marketReviewReceipt(analysis) {
  if (!analysis) return null;
  return {
    candles: analysis.bars,
    closedAt: analysis.last ? analysis.reviewAt : null,
    direction: analysis.direction ?? null,
    volatilityRank: analysis.volatilityRank ?? null,
    block: analysis.block ?? null,
  };
}
