import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveDemoIntent } from './reservation.js';
const env = { PLAYGO_DEMO_EXECUTION_ENABLED:'true', SUPABASE_URL:'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'server_only_dummy_key_for_tests_123456' };
const args = () => ({ env, intent:{ idempotencyKey:'unique_demo_order_123456', stake:0.5, contractType:'CALL', symbol:'R_100', duration:5, durationUnit:'m' },
  account:{id:'demo_123',type:'demo',balance:100,currency:'USD'},
  state:{killSwitch:false,reconciliationHealthy:true,hasUnknownOrders:false,dailyRealizedPnl:0,openContracts:0,tradesToday:0,consecutiveLosses:0,lastTradeAt:0},strategyId:'test_strategy' });
test('disabled by default without flag',async()=>{const a=args();a.env={...env,PLAYGO_DEMO_EXECUTION_ENABLED:'false'};await assert.rejects(()=>reserveDemoIntent(a),/DEMO_EXECUTION_DISABLED/);});
test('real account blocked without network',async()=>{const a=args();a.account.type='real';a.fetchImpl=()=>{throw Error('network should not be called')};assert.equal((await reserveDemoIntent(a)).reason,'REAL_ACCOUNT_DISABLED');});
test('reserves and audits without broker order',async()=>{const a=args();const calls=[];a.fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,status:calls.length===1?201:204,json:async()=>[{id:'reserved-id',status:'reserved'}]};};const result=await reserveDemoIntent(a);assert.equal(result.accepted,true);assert.equal(result.brokerExecution,false);assert.equal(calls.length,2);assert.match(calls[1].url,/playgo_execution_audit/);});
test('duplicate or failed reservation never executes',async()=>{const a=args();a.fetchImpl=async()=>({ok:false,status:409});assert.equal((await reserveDemoIntent(a)).reason,'RESERVATION_NOT_CONFIRMED');});
test('failed audit blocks execution',async()=>{const a=args();let count=0;a.fetchImpl=async()=>{count++;return count===1?{ok:true,status:201,json:async()=>[{id:'reserved-id',status:'reserved'}]}:{ok:false,status:503};};const result=await reserveDemoIntent(a);assert.equal(result.accepted,false);assert.equal(result.reason,'AUDIT_WRITE_FAILED');});
