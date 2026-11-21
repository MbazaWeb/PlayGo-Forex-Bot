import {databaseKey,databaseRoot} from '../../web/server/trading/database-url.js';

export async function brokerDemoState(env,accountId,fetchImpl=fetch){
  const key=databaseKey(env),root=databaseRoot(env);
  if(!root || !key)throw Error('DATABASE_UNAVAILABLE');
  const response=await fetchImpl(root+'/rpc/playgo_broker_demo_state',{method:'POST',redirect:'error',
    headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({p_account:accountId}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('DEMO_PREFLIGHT_UNAVAILABLE');
  const state=await response.json();
  const age=Date.now()-Date.parse(state.lastRecoveryAt);
  if(state.qualified!==true || state.paused!==false || state.unresolved!==false ||
     !(age>=0 && age<120000) || !['string','number'].includes(typeof state.dailyRealizedPnl) ||
     String(state.dailyRealizedPnl).trim()==='')throw Error('DEMO_PREFLIGHT_BLOCKED');
  return {killSwitch:false,reconciliationHealthy:true,hasUnknownOrders:false,
    dailyRealizedPnl:Number(state.dailyRealizedPnl),tradesToday:state.tradesToday,
    consecutiveLosses:state.recentLosses,lastTradeAt:state.lastTradeAt};
}
