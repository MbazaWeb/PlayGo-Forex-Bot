const MINIMUM_BARS = 50;
const TREND_PERIOD = 20;
const BASE_PERIOD = 50;
const RSI_PERIOD = 14;
const VOLATILITY_PERIOD = 20;
const SIGNAL_THRESHOLD = 75;
export const MAX_STAKE_ABSOLUTE_USD = 10;

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function calculateRsi(closes) {
  let gains = 0;
  let losses = 0;
  const start = closes.length - RSI_PERIOD;
  for (let index = start; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}

export function analyzeCandles(candles, intervalSeconds) {
  if (!Array.isArray(candles) || candles.length < MINIMUM_BARS) {
    return { status: 'insufficient', reason: `At least ${MINIMUM_BARS} valid candles are required.` };
  }
  if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0 ||
      candles.some((candle) => !candle || !Number.isFinite(candle.close) || candle.close <= 0 ||
        !Number.isFinite(candle.open) || candle.open <= 0 || !Number.isFinite(candle.epoch))) {
    return { status: 'invalid', reason: 'Market data was invalid.' };
  }

  const closes = candles.map((candle) => candle.close);
  const latest = candles[candles.length - 1];
  const sma20 = average(closes.slice(-TREND_PERIOD));
  const sma50 = average(closes.slice(-BASE_PERIOD));
  const rsi = calculateRsi(closes);
  const momentumPct = ((latest.close / closes[closes.length - 11]) - 1) * 100;
  const returns = closes.slice(1).map((close, index) =>
    Math.abs((close - closes[index]) / closes[index]) * 100,
  );
  const recentReturns = returns.slice(-VOLATILITY_PERIOD);
  const volatilityPct = average(recentReturns);
  const rollingVolatility = [];
  for (let index = VOLATILITY_PERIOD - 1; index < returns.length; index += 1) {
    rollingVolatility.push(average(returns.slice(index - VOLATILITY_PERIOD + 1, index + 1)));
  }
  const volatilityRank = rollingVolatility.filter((value) => value <= volatilityPct).length /
    rollingVolatility.length;

  let bullishScore =
    (latest.close > sma20 ? 20 : 0) +
    (sma20 > sma50 ? 25 : 0) +
    (momentumPct > 0 ? 20 : 0) +
    (rsi >= 50 && rsi < 70 ? 20 : 0) +
    (latest.close > latest.open ? 15 : 0);
  let bearishScore =
    (latest.close < sma20 ? 20 : 0) +
    (sma20 < sma50 ? 25 : 0) +
    (momentumPct < 0 ? 20 : 0) +
    (rsi > 30 && rsi <= 50 ? 20 : 0) +
    (latest.close < latest.open ? 15 : 0);

  if (rsi >= 70) bullishScore -= 15;
  if (rsi <= 30) bearishScore -= 15;

  const direction = bullishScore >= SIGNAL_THRESHOLD && bullishScore > bearishScore
    ? 'bullish'
    : bearishScore >= SIGNAL_THRESHOLD && bearishScore > bullishScore
      ? 'bearish'
      : null;

  return {
    status: 'ready',
    bars: candles.length,
    last: latest,
    sma20,
    sma50,
    rsi,
    momentumPct,
    bullishScore: Math.max(0, bullishScore),
    bearishScore: Math.max(0, bearishScore),
    confluenceScore: Math.max(0, bullishScore, bearishScore),
    direction,
    volatilityPct,
    volatilityRank,
    riskLevel: volatilityRank > 0.8
      ? 'Elevated relative'
      : volatilityRank < 0.2
        ? 'Lower relative'
        : 'Typical relative',
    reviewAt: latest.epoch + intervalSeconds,
  };
}

export const AUTOMATIC_SETUP = Object.freeze({
  interval: 300,
  checkInterval: 45,
  marketsPerScan: 10,
  stopLossPercent: 35,
  takeProfitPercent: 50,
  minimumScore: 85,
  maxVolatilityRank: 0.8,
});

export function automaticEntryBlock(analysis) {
  if (analysis.status !== 'ready' || !analysis.direction ||
      analysis.confluenceScore < AUTOMATIC_SETUP.minimumScore) return 'WEAK_SIGNAL';
  if (analysis.volatilityRank > AUTOMATIC_SETUP.maxVolatilityRank) return 'ELEVATED_VOLATILITY';
  return null;
}
