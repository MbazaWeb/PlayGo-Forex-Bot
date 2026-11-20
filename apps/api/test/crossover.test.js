import test from 'node:test';
import assert from 'node:assert/strict';
import {crossover} from '../../web/api/trading/crossover.js';
for(const [signal,prices] of Object.entries({up:[3,1,1,5],down:[1,3,3,1],none:[1,2,3,4]})){
  test('completed minute candles yield '+signal,()=>{
    const candles=prices.map((close,i)=>({close,epoch:i*60}));
    candles.push({epoch:240,close:999});
    assert.equal(crossover(candles,2,3,240).signal,signal);
  });
}
test('stale data and invalid periods cannot produce signals',()=>{
  assert.equal(crossover([],2,3,240).signal,'unavailable');
  assert.throws(()=>crossover([],3,3,240),/INVALID_STRATEGY/);
});
