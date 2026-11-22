// Net movement divided by total movement over the last 20 completed price changes.
export const AUTOMATIC='system-auto';
export const AUTO_PERIODS={fast:5,slow:20};
export function selectRule(candles){
  const sample=candles.slice(-21);
  let movement=0;
  for(let i=1;i<sample.length;i++)movement+=Math.abs(sample[i].close-sample[i-1].close);
  if(movement===0)return null;
  const displacement=Math.abs(sample.at(-1).close-sample[0].close);
  return displacement/movement>=0.6?'rsi-momentum':'bollinger-bands-reversion';
}
