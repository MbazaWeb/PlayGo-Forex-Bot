import {AUTOMATIC,selectRule,AUTO_PERIODS} from './automatic.js';
import {evaluateStrategy} from './engine.js';
import {DEFAULT_CONFIG} from './config.js';
import {catalog} from './catalog.js';

export function packSignal(rows, settings, minute) {
  const automatic=settings.pack_id===AUTOMATIC;
  if(automatic)settings={...settings,...AUTO_PERIODS};
  if (!automatic && !catalog.some(s=>s.id===settings.pack_id && s.available)) throw Error('INVALID_STRATEGY');
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
  const rule=automatic?selectRule(candles):settings.pack_id;
  const {open,close}=candles.at(-1);
  if(!rule)return {closedAt:minute,signal:"none",open,close,rule:null};
  const result=evaluateStrategy(rule,candles,{...DEFAULT_CONFIG,timeframe:'1m',fastPeriod:settings.fast,slowPeriod:settings.slow});
  if (!result.ready) return unavailable;
  return {closedAt:minute,rule,signal:{BUY:'up',SELL:'down',HOLD:'none'}[result.signal],open,close};
}
