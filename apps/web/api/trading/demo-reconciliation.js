import { atomicDemoTransition } from './atomic-worker.js';

// Broker observations MUST be supplied by a separately authenticated, server-side
// demo-account query. Never accept browser-provided evidence.
const DIGITS = /^[0-9]{1,30}$/;
export function classifyVerifiedDemoObservation(observation) {
  if (!observation || observation.source !== 'deriv-demo-authenticated' || observation.accountMode !== 'demo' || observation.accountVerified !== true || observation.complete !== true) {
    throw new Error('UNVERIFIED_DEMO_EVIDENCE');
  }
  const id = String(observation.contractId ?? '');
  if (!DIGITS.test(id)) throw new Error('INVALID_BROKER_CONTRACT_ID');
  switch (observation.contractStatus) {
    case 'open': return {event:'reconcile_open',brokerContractId:id};
    case 'closed':
      if (observation.settlementVerified !== true) throw new Error('SETTLEMENT_NOT_VERIFIED');
      return {event:'reconcile_closed',brokerContractId:id};
    default: throw new Error('AMBIGUOUS_BROKER_OBSERVATION');
  }
}

export async function reconcileUnknownDemoIntent({intentId, observation, env, fetchImpl}) {
  const decision = classifyVerifiedDemoObservation(observation);
  return atomicDemoTransition({intentId,...decision,env,fetchImpl});
}
