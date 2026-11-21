import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../../web/server/trading/pack/catalog.js';
import {packSignal} from '../../web/server/trading/pack/signal.js';
const minute=1800000000;
const rows=Array.from({length:60},(_,i)=>({epoch:minute-(60-i)*60,open:1+i*.001,high:1.02+i*.001,low:.98+i*.001,close:1.01+i*.001}));
for(const item of catalog) test('pack: '+item.id,()=>{
 const run=()=>packSignal(rows,{pack_id:item.id,fast:5,slow:20},minute);
 if(!item.available)return assert.throws(run,/INVALID_STRATEGY/);
 const r=run();assert.ok(['up','down','none'].includes(r.signal));assert.equal(r.open,rows.at(-1).open);
 if(item.id==='rsi-momentum')assert.equal(r.signal,'up');
});
test('pack rejects missing minutes, stale bars, and malformed OHLC',()=>{
 const config={pack_id:'ema-crossover',fast:5,slow:20};
 for(const bars of [rows.slice(0,-1),rows.slice(10,20),rows.map((r,i)=>i===3?{...r,low:10}:r)])
   assert.deepEqual(packSignal(bars,config,minute),{signal:'unavailable'});
});
test('system automation selects trend or range rules and holds on flat or incomplete data',()=>{
 const config={pack_id:'system-auto',fast:5,slow:20};
 assert.equal(packSignal(rows,config,minute).rule,'rsi-momentum');
 const sample=rows.map((r,i)=>({...r,open:1,high:1.02,low:1,close:1+(i%2)*.01}));
 assert.equal(packSignal(sample,config,minute).rule,'bollinger-bands-reversion');
 assert.equal(packSignal(sample.map(r=>({...r,close:1})),config,minute).signal,'none');
 assert.equal(packSignal(sample.slice(0,-1),config,minute).signal,'unavailable');
});
