import test from 'node:test';
import assert from 'node:assert/strict';
import {readDemoPortfolio} from '../../web/api/trading/demo-portfolio.js';
const accountId='DOT123';
const base={token:'test',accountId,accounts:[{account_id:accountId,account_type:'demo'}]};
for (const accounts of [[],[{account_id:accountId,account_type:'real'}], [...base.accounts,...base.accounts]]) {
  test('deny unverified demo identity '+JSON.stringify(accounts),async()=>{
    await assert.rejects(readDemoPortfolio({...base,accounts,fetchImpl:assert.fail}),/DEMO_ACCOUNT_REQUIRED/);
  });
}
test('read-only portfolio handshake validates request and strips private fields',async()=>{
  let closed=false;
  class Socket {
    constructor(){queueMicrotask(()=>this.onopen());}
    send(data){
      assert.deepEqual(JSON.parse(data),{portfolio:1,req_id:1});
      this.onmessage({data:JSON.stringify({req_id:1,msg_type:'portfolio',portfolio:{contracts:[{contract_id:123,private:'hidden'}]}})});
    }
    close(){closed=true;}
  }
  const fetchImpl=async()=>Response.json({data:{url:'wss://api.derivws.com/trading/v1/options/ws/demo?otp=test'}});
  const result=await readDemoPortfolio({...base,fetchImpl,Socket});
  assert.deepEqual(result.contracts,[{id:'123',symbol:null}]);
  assert.equal(closed,true);
});
test('OTP real endpoint rejected before connection',async()=>{
  const fetchImpl=async()=>Response.json({data:{url:'wss://api.derivws.com/trading/v1/options/ws/real?otp=test'}});
  await assert.rejects(readDemoPortfolio({...base,fetchImpl}),/NOT_A_DEMO_ENDPOINT/);
});

import {readDemoHistory,readMarketQuote} from '../../web/api/trading/demo-portfolio.js';
import {recoverBoundContract} from '../../web/api/trading/recovery-policy.js';
import {readOperations} from '../../web/api/trading/operations.js';
function broker(replies) {
  const requests=[];
  class Socket {
    constructor(){queueMicrotask(()=>this.onopen());}
    send(data){
      const req=JSON.parse(data);
      requests.push(req);
      const kind=Object.keys(req)[0];
      const msg_type=kind==='ticks'?'tick':kind;
      this.onmessage({data:JSON.stringify({req_id:req.req_id,msg_type,[msg_type]:replies[kind]})});
    }
    close(){}
  }
  return {requests,context:{...base,accounts:[{...base.accounts[0],currency:'USD'}],Socket,
    fetchImpl:async()=>Response.json({data:{url:'wss://api.derivws.com/trading/v1/options/ws/demo?otp=fixture'}})}};
}
test('mock demo quote verifies available contract, receives tick and quote without buy',async()=>{
  const {context,requests}=broker({contracts_for:{available:[{contract_type:'CALL'}]},
    ticks:{symbol:'frxEURUSD',epoch:123,quote:1.2},proposal:{ask_price:'1',payout:'1.8'}});
  const quote=await readMarketQuote(context,{symbol:'frxEURUSD',contractType:'CALL',duration:5,durationUnit:'m',stake:1});
  assert.equal(quote.proposal.ask,'1');
  assert.deepEqual(requests.map(r=>Object.keys(r)[0]),['contracts_for','ticks','proposal']);
});
test('mock history rejects missing proceeds',async()=>{
  const {context}=broker({profit_table:{transactions:[{transaction_id:123,buy_price:1}]}});
  await assert.rejects(readDemoHistory(context),/INVALID_BROKER_RESPONSE/);
});
test('recovery requires durable association and broker-confirmed contract details',async()=>{
  const {context}=broker({proposal_open_contract:{contract_id:123,contract_type:'CALL',underlying_symbol:'R_100',is_sold:1,status:'won',buy_price:'1',sell_time:123,sell_price:'1.8'}});
  const intent={id:'fixture',status:'unknown',account_id:accountId,account_mode:'demo',symbol:'R_100',contract_type:'CALL',broker_contract_id:'123'};
  const atomicTransition=async command=>command;
  assert.equal((await recoverBoundContract({context,intent,atomicTransition})).event,'reconcile_closed');
  assert.equal((await recoverBoundContract({context,intent:{...intent,broker_contract_id:null},atomicTransition})).action,'hold');
  await assert.rejects(recoverBoundContract({context,intent:{...intent,symbol:'other'},atomicTransition}),/INVALID_BROKER_RESPONSE/);
});
test('operations rejects data outside verified account',async()=>{
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
  await assert.rejects(readOperations({...base,env,fetchImpl:async()=>Response.json([{account_id:'other'}])}),/ACCOUNT_MISMATCH/);
});

import {recoverDemo} from '../src/recover-demo.js';
test('restart scan holds unknown intent lacking a broker contract; makes no transition',async()=>{
  const env={DERIV_DEMO_ACCOUNT_ID:accountId,DERIV_DEMO_TOKEN:'fixture',DERIV_CLIENT_ID:'fixture',
    SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',
    PLAYGO_DEMO_EXECUTION_ENABLED:'true',LIVE_TRADING_ENABLED:'false'};
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(String(url));
    if(String(url).includes('playgo_demo_worker_health')) return new Response(null,{status:204});
    if(calls.length===1)return Response.json({data:base.accounts});
    assert.equal(new URL(url).searchParams.get('account_id'),'eq.'+accountId);
    return Response.json([{account_id:accountId,account_mode:'demo',status:'unknown',broker_contract_id:null}]);
  };
  assert.deepEqual(await recoverDemo({env,fetchImpl}),{observed:1,held:1,transitioned:0});
  assert.equal(calls.length,3);
});

import {qualifyDemoExecution} from '../../web/api/trading/execute-demo.js';
test('ambiguous purchase enters unknown exactly once',async()=>{
  const events=[];
  const result=await qualifyDemoExecution({env:{PLAYGO_ENV:'test',LIVE_TRADING_ENABLED:'false'}},{
    reserve:async()=>({accepted:true,reservationId:'fixture'}),
    transition:async({event})=>{events.push(event);return event;},
    testBroker:async()=>{events.push('buy');throw Error('disconnected');}
  });
  assert.equal(result,'uncertainty');
  assert.deepEqual(events,['submit','buy','uncertainty']);
});
test('lost worker claim prevents broker dispatch',async()=>{
  let dispatched=false;
  await assert.rejects(qualifyDemoExecution({env:{PLAYGO_ENV:'test',LIVE_TRADING_ENABLED:'false'}},{
    reserve:async()=>({accepted:true,reservationId:'fixture'}),
    transition:async()=>{throw Error('claim conflict');},
    testBroker:async()=>{dispatched=true;}
  }),/claim conflict/);
  assert.equal(dispatched,false);
});
