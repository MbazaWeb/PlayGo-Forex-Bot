function price(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

export function reviewLoss(trade, order, exit) {
  const detail = trade.review || {};
  const entry = price(detail.entrySpot), end = price(detail.exitSpot);
  const direction = detail.direction || order?.direction;
  const loss = Number((trade.buy - trade.sell).toFixed(8));
  const observed = [`Paid ${trade.buy}; received ${trade.sell}. Loss: ${loss}.`];
  const earlySale = detail.status === 'sold' || Boolean(exit);
  if (exit) observed.push(exit.reason + '.');
  else if (earlySale) observed.push('Deriv recorded a sale before settlement at expiry.');
  if (entry != null && end != null) {
    const move = end > entry ? 'rose' : end < entry ? 'fell' : 'was unchanged';
    observed.push(`Price ${move} from ${entry} to ${end}.`);
    if (!earlySale && detail.status === 'lost' && ['CALL','PUT'].includes(direction)) {
      const against = direction === 'CALL' ? end < entry : end > entry;
      if (against) observed.push(`The final move opposed the ${direction === 'CALL' ? 'Rise' : 'Fall'} entry.`);
    }
  }
  let test = 'Compare entries for the same market and duration on later demo trades. Measure net return per unit staked.';
  if (earlySale) test = 'Replay the exit rule against holding to expiry on the same demo entries. Compare net return and drawdown.';
  else if (!order?.strategy) test = 'Recover the order record and strategy before assigning this loss to an agent.';
  else if (order.strategy === 'Low-volatility breakout') test = 'Test a second candle of breakout confirmation on later demo entries. Compare net return and missed winners.';
  else if (order.strategy === 'Trend + momentum') test = 'Compare this signal with winners at similar momentum, volatility and duration before changing the entry filter.';
  const gaps = [];
  if (!order?.strategy) gaps.push('Strategy unavailable');
  if (!order?.entry) gaps.push('Entry indicators unavailable');
  if (!exit && !detail.status) gaps.push('Exit reason unavailable');
  if (entry == null || end == null) gaps.push('Entry or exit price unavailable');
  return { observed: observed.join(' '), gaps: gaps.join('. ') || 'Entry and exit evidence available. Market cause remains unverified.', test };
}
