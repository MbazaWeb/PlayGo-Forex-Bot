import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDemoOrder} from '../src/ticket/demo.js';
const env={PLAYGO_ENV:'test',LIVE_TRADING_ENABLED:'false',PLAYGO_DEMO_EXECUTION_ENABLED:'true',
 DERIV_DEMO_ACCOUNT_ID:'DOT123',DERIV_DEMO_TOKEN:'fixture',DERIV_CLIENT_ID:'fixture'};
const input={env,intent:{stake:1,symbol:'frxEURUSD',contractType:'CALL',duration:5,durationUnit:'m'}};
test('native broker transport stays locked',async()=>assert.rejects(executeDemoOrder(input),/DISABLED/));
for(const scenario of ['success','disconnect','price','claim','real']){
 test('demo socket workflow '+scenario,async()=>{
  const actions=[];
  class Socket extends EventTarget{
   constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
   send(raw){
    const req=JSON.parse(raw),type=Object.keys(req)[0];actions.push(type);
    if(type==='buy' && scenario==='disconnect'){this.close();return;}
    const values={contracts_for:{available:[{contract_type:'CALL'}]},proposal:{id:'fixture-id',ask_price:scenario==='price'?'2':'1'},buy:{contract_id:123,buy_price:1}};
    this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({msg_type:type,req_id:req.req_id,[type]:values[type]})}));
   }
   close(){this.dispatchEvent(new Event('close'));}
  }
  const f={Socket,fetchImpl:async url=>Response.json({data:url.endsWith('/otp')?{url:'wss://api.derivws.com/trading/v1/options/ws/demo?otp=fixture'}:[{account_id:'DOT123',account_type:scenario==='real'?'real':'demo',currency:'USD',balance:100}]}),
   reserve:async()=>({accepted:true,reservationId:'fixture'}),transition:async({event})=>{actions.push(event);if(scenario==='claim')throw Error('LOST_CLAIM');return event;}};
  if(scenario==='real'||scenario==='claim')await assert.rejects(executeDemoOrder(input,f),scenario==='real'?/DEMO_ACCOUNT_REQUIRED/:/LOST_CLAIM/);
  else await executeDemoOrder(input,f);
  const expected={success:['submit','buy','confirm'],disconnect:['submit','buy','uncertainty'],price:['cancel'],claim:['submit']};
  assert.deepEqual(actions,scenario==='real'?[]:['contracts_for','proposal',...expected[scenario]]);
 });
}
