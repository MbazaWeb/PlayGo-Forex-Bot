import {evaluateStrategy} from './engine.js';
import {DEFAULT_CONFIG} from './config.js';
import {catalog} from './catalog.js';

export function packSignal(rows, settings, minute) {
  if (!catalog.some(s=>s.id===settings.pack_id && s.available)) throw Error('INVALID_STRATEGY');
  const unavailable={signal:'unavailable'};
  const minimum=Math.max(settings.slow*2,40);
  if (!Array.isArray(rows) || rows.length<minimum) return unavailable;
  const candles=[];
  for (const [i,row] of rows.entries()) {
    if (row?.epoch!==minute-(rows.length-i)*60) return unavailable;
    const fields=['open','high','low','close'];
    if (!fields.every(k=>['string','number'].includes(typeof row[k]) && Number.isFinite(+row[k]) && +row[k]>0)) return unavailable;
    const [open,high,low,close]=fields.map(k=>Number(row[k]));
    if (high<Math.max(open,close) || low>Math.min(open,close)) return unavailable;
    candles.push({ts:new Date(row.epoch*1000).toISOString(),open,high,low,close});
  }
  const result=evaluateStrategy(settings.pack_id,candles,{...DEFAULT_CONFIG,timeframe:'1m',fastPeriod:settings.fast,slowPeriod:settings.slow});
  if (!result.ready) return unavailable;
  const {open,close}=candles.at(-1);
  return {closedAt:minute,signal:{BUY:'up',SELL:'down',HOLD:'none'}[result.signal],open,close};
}
