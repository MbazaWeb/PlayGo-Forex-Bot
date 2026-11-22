import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyPass} from '../src/strategy/demo.js';
const id='DOT123';
const env={PLAYGO_SIGNAL_WORKER_ENABLED:'true',LIVE_TRADING_ENABLED:'false',DERIV_DEMO_ACCOUNT_ID:id,DERIV_DEMO_TOKEN:'fixture',
 DERIV_CLIENT_ID:'fixture',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
test('disabled worker performs no network operations',async()=>{
 await assert.rejects(strategyPass({env:{},fetchImpl:assert.fail}),/WORKER_DISABLED/);
});
for(const mode of ['paused','updated','superseded','real']){
 test('background pass '+mode,async()=>{
  const messages=[];
  class Socket {
    constructor(){queueMicrotask(()=>this.onopen());}
    send(raw){
      const q=JSON.parse(raw);messages.push(Object.keys(q)[0]);
      const minute=Number(q.end)+1;
      this.onmessage({data:JSON.stringify({req_id:q.req_id,msg_type:'candles',
        candles:[3,1,1,5].map((close,i)=>({epoch:minute-(4-i)*60,close}))})});
    }
    close(){}
  }
  const row={account_id:id,enabled:mode!=='paused',fast:2,slow:3,version:'fixture',observed_minute:null};
  const fetchImpl=async(url,init)=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/accounts'))return Response.json({data:[{account_id:id,account_type:mode==='real'?'real':'demo'}]});
    if(path.endsWith('/otp'))return Response.json({data:{url:'wss://api.derivws.com/trading/v1/options/ws/demo?otp=fixture'}});
    assert.equal(path,'/rest/v1/playgo_demo_strategies');
    assert.equal(new URL(url).searchParams.get('account_id'),'eq.'+id);
    if(init.method==='PATCH'){
      assert.equal(new URL(url).searchParams.get('version'),'eq.fixture');
      assert.equal(JSON.parse(init.body).signal,'up');
      return Response.json(mode==='superseded'?[]:[row]);
    }
    assert.equal(init.method,'GET');return Response.json([row]);
  };
  if(mode==='real')await assert.rejects(strategyPass({env,fetchImpl,Socket}),/DEMO_ACCOUNT_REQUIRED/);
  else assert.equal(await strategyPass({env,fetchImpl,Socket}),mode);
  assert.deepEqual(messages,mode==='real'||mode==='paused'?[]:['ticks_history']);
 });
}
