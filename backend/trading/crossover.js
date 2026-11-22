export function validPeriods(fast,slow) {
  return Number.isInteger(fast) && Number.isInteger(slow) && fast>=2 && slow>fast && slow<=100;
}

// Use consecutive completed minute candles. Missing minutes break the signal.
export function crossover(candles,fast,slow,minute) {
  if (!validPeriods(fast,slow)) throw Error('INVALID_STRATEGY');
  const rows=candles.filter(c=>c.epoch<minute).slice(-(slow+1));
  if(rows.length!==slow+1 || rows.some((c,i)=>c.epoch!==minute-(rows.length-i)*60 ||
     !['number','string'].includes(typeof c.close) || !Number.isFinite(Number(c.close)) || Number(c.close)<=0))
    return {signal:'unavailable'};
  function mean(period,end) {
    return rows.slice(end-period,end).reduce((sum,c)=>sum+Number(c.close),0)/period;
  }
  const end=rows.length;
  const before=mean(fast,end-1)-mean(slow,end-1);
  const after=mean(fast,end)-mean(slow,end);
  const signal=before<=0 && after>0?'up':before>=0 && after<0?'down':'none';
  return {signal,closedAt:minute};
}
