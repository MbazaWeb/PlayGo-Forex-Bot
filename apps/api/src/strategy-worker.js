import {recoverDemo} from './recover-demo.js';
import {executeDemoOrder} from './demo-order.js';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {listAccounts} from './providers/deriv.js';
import {readDemoSignal,readPackSignal} from '../../web/server/trading/demo-portfolio.js';
import {strategyStore} from '../../web/server/trading/strategy-store.js';

export async function strategyPass({env=process.env,fetchImpl=fetch,Socket=WebSocket}={}) {
  if(env.PLAYGO_SIGNAL_WORKER_ENABLED!=='true' || env.LIVE_TRADING_ENABLED!=='false') throw Error('WORKER_DISABLED');
  const {DERIV_DEMO_ACCOUNT_ID:accountId,DERIV_DEMO_TOKEN:token,DERIV_CLIENT_ID:appId}=env;
  if(!accountId||!token||!appId) throw Error('DEMO_AUTH_REQUIRED');
  const accounts=await listAccounts(token,fetchImpl,appId);
  const ctx={env,token,accountId,accounts,appId,fetchImpl,Socket};
  const brokerMode=env.PLAYGO_DEMO_EXECUTION_ENABLED==='true' && env.PLAYGO_BROKER_DEMO_ACCOUNT===accountId;
  if(brokerMode)await recoverDemo({env,fetchImpl,Socket});
  const saved=await strategyStore(ctx);
  if(!saved?.enabled) return 'paused';
  const minute=Math.floor(Date.now()/60000)*60;
  if(saved.observed_minute>=minute) return 'current';
  const result=saved.pack_id ? await readPackSignal(ctx,saved) : await readDemoSignal(ctx,new URLSearchParams({fast:saved.fast,slow:saved.slow}));
  const row=await strategyStore(ctx,'publish',{version:saved.version,minute:result.closedAt??minute,signal:result.signal,open:result.open,close:result.close});
  if(row && saved.pack_id && brokerMode && result.closedAt===minute && ['up','down'].includes(result.signal)){
    const outcome=await executeDemoOrder({env,strategyId:'deriv-'+saved.pack_id,intent:{
      idempotencyKey:saved.version+'_'+minute,symbol:'frxEURUSD',contractType:result.signal==='up'?'CALL':'PUT',
      duration:15,durationUnit:'m',stake:1}});
    return outcome.status==='confirmed'?'demo contract confirmed':'demo order held';
  }
  return row?'updated':'superseded';
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.env.PLAYGO_SIGNAL_WORKER_ENABLED!=='true' || process.env.LIVE_TRADING_ENABLED!=='false') {
    console.error('Signal worker disabled.');process.exitCode=1;
  } else {
    do {
      try { console.log(await strategyPass()); }
      catch { console.error('Signal check unavailable.');if(process.argv.includes('--once'))process.exitCode=1; }
      if(process.argv.includes('--once')) break;
      await delay(60000);
    } while(true);
  }
}
