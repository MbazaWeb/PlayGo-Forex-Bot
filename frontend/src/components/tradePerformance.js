export function summarizeClosedTrades(input) {
  // Drawdown is only meaningful in settlement order, oldest first.
  const trades = input.every(t => Number.isFinite(t.settledAt))
    ? input.slice().sort((a, b) => a.settledAt - b.settledAt)
    : input;
  let winCount = 0;
  let lossCount = 0;
  let gains = 0;
  let losses = 0;
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;

  for (const { value } of trades) {
    if (value > 0) { gains += value; winCount++; }
    if (value < 0) { losses -= value; lossCount++; }
    cumulative += value;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }

  return {
    net: cumulative,
    averageWin: winCount ? gains / winCount : null,
    averageLoss: lossCount ? -losses / lossCount : null,
    average: trades.length ? cumulative / trades.length : null,
    profitFactor: losses > 0 ? gains / losses : null,
    drawdown,
  };
}
