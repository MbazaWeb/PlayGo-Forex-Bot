import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerDemoState} from '../src/broker-demo-state.js';

const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const current=()=>({qualified:true,paused:false,unresolved:false,lastRecoveryAt:new Date().toISOString(),
  dailyRealizedPnl:'-1.25',tradesToday:2,recentLosses:1,lastTradeAt:0});
const read=state=>brokerDemoState(env,'demo123',async(url,options)=>{
  assert.equal(new URL(url).pathname,'/rest/v1/rpc/playgo_broker_demo_state');
  assert.deepEqual(JSON.parse(options.body),{p_account:'demo123'});
  return Response.json(state);
});
test('demo broker preflight uses current account risk evidence',async()=>{
  const state=await read(current());
  assert.equal(state.dailyRealizedPnl,-1.25);assert.equal(state.tradesToday,2);
});
for(const [field,value] of [['qualified',false],['paused',true],['unresolved',true],['lastRecoveryAt',null],['lastRecoveryAt','2000-01-01'],['dailyRealizedPnl',null]]){
  test('demo broker preflight blocks '+field+'='+value,async()=>{
    await assert.rejects(read({...current(),[field]:value}),/PREFLIGHT_BLOCKED/);
  });
}
