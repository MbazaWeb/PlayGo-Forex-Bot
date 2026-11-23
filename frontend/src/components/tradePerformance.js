export function summarizeClosedTrades(trades) {
  let gains = 0;
  let losses = 0;
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;

  for (const { value } of trades) {
    if (value > 0) gains += value;
    if (value < 0) losses -= value;
    cumulative += value;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }

  return {
    net: cumulative,
    average: trades.length ? cumulative / trades.length : null,
    profitFactor: losses > 0 ? gains / losses : null,
    drawdown,
  };
}
