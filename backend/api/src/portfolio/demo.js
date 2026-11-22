import {databaseKey,databaseRoot} from '../../../trading/database-url.js';

export async function readBrokerDemoState(env,accountId,fetchImpl=fetch){
  const key=databaseKey(env),root=databaseRoot(env);
  if(!root || !key)throw Error('DATABASE_UNAVAILABLE');
  const response=await fetchImpl(root+'/rpc/playgo_broker_demo_state',{method:'POST',redirect:'error',
    headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({p_account:accountId}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('DEMO_PREFLIGHT_UNAVAILABLE');
  const state=await response.json();
  if(!state || typeof state!=='object' || Array.isArray(state))throw Error('INVALID_RISK_STATUS');
  const rawPnl=typeof state.dailyRealizedPnl==='string' ? state.dailyRealizedPnl.trim() : state.dailyRealizedPnl;
  const pnlValid=typeof rawPnl==='number' ? Number.isFinite(rawPnl)
    : typeof rawPnl==='string' && /^-?\d+(\.\d+)?$/.test(rawPnl);
  const pnl=pnlValid ? Number(rawPnl) : NaN;
  const lastRecoveryAt=typeof state.lastRecoveryAt==='string' && Number.isFinite(Date.parse(state.lastRecoveryAt))
    ? state.lastRecoveryAt : null;
  const age=lastRecoveryAt ? Date.now()-Date.parse(lastRecoveryAt) : NaN;
  const qualified=state.qualified===true;
  const paused=typeof state.paused==='boolean' ? state.paused : null;
  const unresolved=typeof state.unresolved==='boolean' ? state.unresolved : null;
  const healthyRecovery=age>=0 && age<120000;
  const pnlVerified=Number.isFinite(pnl);
  const message=!qualified ? 'Demo account qualification is pending.'
    : paused!==false ? 'The account kill switch is paused.'
    : unresolved!==false ? 'An existing order is awaiting settlement or reconciliation.'
    : !healthyRecovery ? 'The recovery worker has no recent successful check.'
    : !pnlVerified ? 'Daily profit and loss is unverified.'
    : 'Demo ready.';
  return {
    ready:qualified && paused===false && unresolved===false && healthyRecovery && pnlVerified,
    qualified,paused,unresolved,lastRecoveryAt,
    dailyRealizedPnl:pnlVerified ? pnl : null,
    tradesToday:Number.isSafeInteger(state.tradesToday) ? state.tradesToday : null,
    recentLosses:Number.isSafeInteger(state.recentLosses) ? state.recentLosses : null,
    lastTradeAt:state.lastTradeAt ?? null,
    message,
  };
}

export async function brokerDemoState(env,accountId,fetchImpl=fetch){
  const status=await readBrokerDemoState(env,accountId,fetchImpl);
  if(!status.ready)throw Error('DEMO_PREFLIGHT_BLOCKED: '+status.message);
  return {killSwitch:false,reconciliationHealthy:true,hasUnknownOrders:false,
    qualified:status.qualified,paused:status.paused,unresolved:status.unresolved,
    lastRecoveryAt:status.lastRecoveryAt,dailyRealizedPnl:status.dailyRealizedPnl,
    tradesToday:status.tradesToday,consecutiveLosses:status.recentLosses,lastTradeAt:status.lastTradeAt};
}
