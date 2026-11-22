import {executeDemoOrder} from './ticket/demo.js';
import {listAccounts} from './providers/deriv.js';
import {readBrokerDemoState} from './portfolio/demo.js';

export async function manualTicket({method,params,token,appId,env=process.env,fetchImpl=fetch}){
  const blocked=(message,status=409,details={})=>({status,body:{ready:false,message,...details}});
  const id=params.get('account');
  if(env.LIVE_TRADING_ENABLED!=='false'||env.PLAYGO_DEMO_EXECUTION_ENABLED!=='true')
    return blocked('Demo orders are disabled.');
  if(!id || id!==env.PLAYGO_BROKER_DEMO_ACCOUNT || id!==env.DERIV_DEMO_ACCOUNT_ID)
    return blocked('This account is not configured for demo execution.',403);
  try{
    const accounts=await listAccounts(token,fetchImpl,appId);
    const matches=accounts.filter(row=>row.account_id===id);
    if(matches.length!==1||matches[0].account_type!=='demo')return blocked('Sign in with the configured Deriv demo account.',403);
    if(method==='GET'){
      const state=await readBrokerDemoState(env,id,fetchImpl);
      const {qualified,paused,unresolved,lastRecoveryAt,dailyRealizedPnl}=state;
      return {status:state.ready?200:409,body:{ready:state.ready,message:state.message,
        qualified,paused,unresolved,lastRecoveryAt,dailyRealizedPnl}};
    }
    const key=params.get('key'),stake=Number(params.get('stake')),duration=Number(params.get('minutes'));
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key||'')||
      !/^[A-Za-z0-9_]{2,30}$/.test(params.get('symbol')||'')||!['CALL','PUT'].includes(params.get('direction'))||
      !Number.isFinite(stake)||stake<=0||stake>1||!Number.isInteger(duration)||duration<1||duration>60)
      return blocked('Check market, direction, stake (up to 1), and duration (1â€“60 minutes).',400);
    const result=await executeDemoOrder({env:{...env,DERIV_DEMO_TOKEN:token,DERIV_CLIENT_ID:appId},
      strategyId:'deriv-manual-ticket',intent:{idempotencyKey:'manual_'+key,stake,duration,durationUnit:'m',
        symbol:params.get('symbol'),contractType:params.get('direction')}});
    if(result.status==='confirmed')return {status:200,body:{status:'confirmed',message:'Deriv confirmed your demo order.',intentId:result.intentId}};
    if(result.status==='rejected')return blocked('Order stopped before purchase. Deriv did not provide an eligible contract and price.');
    if(result.reason && result.reason!=='RESERVATION_NOT_CONFIRMED')return blocked('Order blocked by account risk checks: '+result.reason.replaceAll('_',' ').toLowerCase()+'.');
    return blocked('Order status requires reconciliation. Check Portfolio before placing another order.');
  }catch(error){
    if(error.status===401)return blocked('Deriv session expired. Sign in again.',401);
    if(error.message.startsWith('DEMO_PREFLIGHT_BLOCKED'))return blocked(error.message.split(': ')[1]||'Demo account risk checks blocked submission.');
    if(['DATABASE_UNAVAILABLE','DEMO_PREFLIGHT_UNAVAILABLE'].includes(error.message))return blocked('Order service unavailable. Retry the status check.',503);
    return blocked(method==='GET'?'Could not verify demo execution status.':'Could not confirm the order. Check Portfolio before placing another order.',503);
  }
}
