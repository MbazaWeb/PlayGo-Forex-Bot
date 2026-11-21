import {readContractEvidence} from './demo-portfolio.js';
// Pure, fail-closed recovery policy. No network or broker orders.
const STATES = new Set(['reserved','submitted','confirmed','unknown','rejected','settled']);
const ID = /^[0-9]{1,30}$/;
export function recoveryDecision(intent, evidence) {
  if (!intent || intent.account_mode !== 'demo' || !STATES.has(intent.status)) return {action:'block',reason:'INVALID_DEMO_INTENT'};
  if (intent.status === 'rejected' || intent.status === 'settled') return {action:'none',reason:'TERMINAL'};
  if (intent.status === 'reserved') return {action:'hold',reason:'RESERVATION_REQUIRES_AUTHORITATIVE_REVIEW'};
  if (!evidence || evidence.source !== 'authenticated_deriv_server' || evidence.account_mode !== 'demo' || evidence.account_id !== intent.account_id || evidence.verified !== true)
    return {action:'hold',reason:'UNVERIFIED_BROKER_EVIDENCE'};
  if (evidence.not_found === true) return {action:'hold',reason:'NOT_FOUND_IS_NOT_REJECTION'};
  if (!ID.test(String(evidence.contract_id ?? ''))) return {action:'hold',reason:'INVALID_CONTRACT_ID'};
  if (intent.broker_contract_id && String(intent.broker_contract_id) !== String(evidence.contract_id)) return {action:'block',reason:'CONTRACT_MISMATCH'};
  if (evidence.is_sold === true && evidence.settlement_verified === true && evidence.is_open === false)
    return {action:'reconcile',event:intent.status === 'confirmed' ? 'settle' : 'reconcile_closed',brokerContractId:String(evidence.contract_id)};
  if (evidence.is_open === true && evidence.is_sold === false && intent.status === 'unknown')
    return {action:'reconcile',event:'reconcile_open',brokerContractId:String(evidence.contract_id)};
  if (evidence.is_open === true && evidence.is_sold === false && intent.status === 'submitted')
    return {action:'reconcile',event:'confirm',brokerContractId:String(evidence.contract_id)};
  return {action:'hold',reason:'AMBIGUOUS_BROKER_STATE'};
}
export async function reconcileRecoveredIntent({intent,evidence,atomicTransition}) {
  const decision = recoveryDecision(intent,evidence);
  if (decision.action !== 'reconcile') return decision;
  if (typeof atomicTransition !== 'function') throw Error('ATOMIC_TRANSITION_REQUIRED');
  return atomicTransition({intentId:intent.id,event:decision.event,brokerContractId:decision.brokerContractId});
}

// Called only with an intent read from durable storage and a server-owned session.
export async function recoverBoundContract({intent,context,atomicTransition}) {
  if (!intent?.broker_contract_id || intent.account_id !== context.accountId)
    return {action:'hold',reason:'DURABLE_CONTRACT_BINDING_REQUIRED'};
  if (!['confirmed','submitted','unknown'].includes(intent.status))
    return recoveryDecision(intent,null);
  const evidence = await readContractEvidence(context,intent);
  if (evidence.settlement_verified) {
    if (intent.status === 'submitted')
      await atomicTransition({intentId:intent.id,event:'confirm',brokerContractId:evidence.contract_id});
    return atomicTransition({intentId:intent.id,event:intent.status==='unknown'?'reconcile_closed':'settle',
      brokerContractId:evidence.contract_id,settlement:evidence.settlement});
  }
  return reconcileRecoveredIntent({intent,evidence,atomicTransition});
}
