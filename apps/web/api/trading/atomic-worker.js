import {nextExecutionState} from './execution-state.js';
// Internal-only demo worker. No broker submission and no public route.
function requireWorkerConfig(env) {
  if (env.PLAYGO_DEMO_EXECUTION_ENABLED !== 'true') throw Error('DEMO_EXECUTION_DISABLED');
  if (env.LIVE_TRADING_ENABLED === 'true') throw Error('LIVE_TRADING_MUST_BE_DISABLED');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL || '') || (env.SUPABASE_SERVICE_ROLE_KEY || '').length < 24) throw Error('WORKER_DATABASE_NOT_CONFIGURED');
  return {url:env.SUPABASE_URL.replace(/\/$/,''),key:env.SUPABASE_SERVICE_ROLE_KEY};
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FROM = Object.freeze({
  submit:'reserved',cancel:'reserved',confirm:'submitted',reject:'submitted',
  settle:'confirmed',reconcile_open:'unknown',reconcile_closed:'unknown',reconcile_rejected:'unknown'
});
export async function atomicDemoTransition({intentId,event,brokerContractId,env=process.env,fetchImpl=fetch}) {
  if (!UUID.test(intentId || '')) throw Error('INVALID_INTENT_ID');
  if (!Object.hasOwn(FROM,event) && event !== 'uncertainty') throw Error('INVALID_EVENT');
  if (['confirm','reconcile_open','reconcile_closed'].includes(event) && !/^[0-9]{1,30}$/.test(String(brokerContractId || '')))
    throw Error('BROKER_CONTRACT_ID_REQUIRED');
  if (brokerContractId !== undefined && !/^[0-9]{1,30}$/.test(String(brokerContractId)))
    throw Error('INVALID_BROKER_CONTRACT_ID');
  const db = requireWorkerConfig(env);
  const response = await fetchImpl(db.url+'/rest/v1/rpc/playgo_atomic_demo_transition', {
    method:'POST',
    headers:{apikey:db.key,Authorization:'Bearer '+db.key,'Content-Type':'application/json'},
    body:JSON.stringify({p_intent_id:intentId,p_event:event,p_contract_id:brokerContractId===undefined?null:String(brokerContractId)}),
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error('ATOMIC_TRANSITION_FAILED_'+response.status);
  const result = await response.json();
  if (result?.audited !== true || result.intentId !== intentId ||
      (event !== 'uncertainty' && result.previous !== FROM[event]) ||
      nextExecutionState(result.previous,event) !== result.status)
    throw Error('INVALID_ATOMIC_TRANSITION_RESPONSE');
  return result;
}
