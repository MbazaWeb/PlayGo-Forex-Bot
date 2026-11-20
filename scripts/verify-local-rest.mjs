import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac,randomBytes,randomInt} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {strategyStore} from '../apps/web/api/trading/strategy-store.js';
import {readOperations} from '../apps/web/api/trading/operations.js';
import {reserveDemoIntent} from '../apps/web/api/trading/reservation.js';
import {atomicDemoTransition} from '../apps/web/api/trading/atomic-worker.js';
import {recoverDemo} from '../apps/api/src/recover-demo.js';

export async function verifyLocalRest(admin,pgPort) {
  const password=randomBytes(24).toString('hex'),secret=randomBytes(32).toString('hex');
  const role='playgo_rest_auth';
  await admin.query("create role "+role+" login noinherit password '"+password+"'; grant service_role,anon to "+role);
  const port=randomInt(50001,60000);
  const origin='http://127.0.0.1:'+port;
  const rest=spawn(process.env.POSTGREST_BIN||'postgrest',[],{stdio:'ignore',env:{...process.env,
    PGRST_DB_URI:'postgres://'+role+':'+password+'@127.0.0.1:'+pgPort+'/postgres',
    PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,
    PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(port)}});
  let launchError;
  rest.on('error',error=>{launchError=error;});
  const stopped=new Promise(resolve=>rest.once('close',resolve));
  try{
    let ready=false;
    for(let i=0;i<80;i++){
      if(launchError || rest.exitCode!==null)throw Error('PostgREST startup failed. Set POSTGREST_BIN to its executable path.');
      try{ready=(await fetch(origin+'/',{signal:AbortSignal.timeout(500)})).ok;}catch{}
      if(ready)break;
      await delay(100);
    }
    assert.ok(ready,'PostgREST readiness');
    const unsigned=[{alg:'HS256',typ:'JWT'},{role:'service_role',exp:Math.floor(Date.now()/1000)+120}]
      .map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    const jwt=unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url');
    const accountId='local-rest-demo',accounts=[{account_id:accountId,account_type:'demo'}];
    const env={PLAYGO_ENV:'local',PLAYGO_LOCAL_REST_URL:origin,PLAYGO_LOCAL_WORKER_JWT:jwt,
      PLAYGO_DEMO_EXECUTION_ENABLED:'true',LIVE_TRADING_ENABLED:'false',
      DERIV_DEMO_TOKEN:'fixture',DERIV_DEMO_ACCOUNT_ID:accountId,DERIV_CLIENT_ID:'fixture'};
    const ctx={accounts,accountId,env};
    assert.equal((await strategyStore(ctx,'save',{fast:3,slow:12,enabled:true})).slow,12);
    assert.equal((await strategyStore(ctx)).fast,3);
    assert.equal((await readOperations(ctx)).status.paused,true);
    const fetchImpl=(url,init)=>{
      if(String(url)==='https://api.derivws.com/trading/v1/options/accounts')return Response.json({data:accounts});
      assert.equal(new URL(url).origin,origin);
      return fetch(url,init);
    };
    assert.deepEqual(await recoverDemo({env,fetchImpl}),{observed:0,held:0,transitioned:0});
    assert.ok((await readOperations(ctx)).status.lastRecoveryAt);
    await admin.query('insert into playgo_demo_controls values ($1,false)',[accountId]);
    const reserved=await reserveDemoIntent({env,account:{id:accountId,type:'demo',balance:10,currency:'USD'},
      intent:{idempotencyKey:'local-rest-check-0001',stake:1,contractType:'CALL',symbol:'frxEURUSD',duration:5,durationUnit:'m'},
      state:{killSwitch:false,reconciliationHealthy:true,hasUnknownOrders:false,dailyRealizedPnl:0,openContracts:0,tradesToday:0,consecutiveLosses:0,lastTradeAt:0},
      strategyId:'crossover'});
    assert.ok(reserved.accepted);
    const transition=(event,brokerContractId,settlement)=>atomicDemoTransition({env,intentId:reserved.reservationId,event,brokerContractId,settlement});
    await transition('submit');
    await transition('confirm','900123');
    await transition('settle','900123',{cost:'1',proceeds:'1.80',soldAt:Math.floor(Date.now()/1000)});
    assert.equal(Number((await readOperations(ctx)).status.dailyRealizedPnl),0.8);
    assert.ok([401,403].includes((await fetch(origin+'/playgo_demo_strategies')).status));
    console.log('PASS authenticated local PostgREST strategy save/read, risk status, recovery heartbeat and anonymous denial.');
  } finally {rest.kill();await stopped;}
}
