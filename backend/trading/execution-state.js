// Pure, fail-closed Deriv demo order lifecycle. No network, credentials, or broker calls.
// A transport timeout after submission is UNKNOWN, never a reason to buy again.
export const EXECUTION_STATES = Object.freeze(['reserved','submitted','confirmed','rejected','unknown','settled']);
const transitions = Object.freeze({
  reserved: Object.freeze({ submit:'submitted', cancel:'rejected', uncertainty:'unknown' }),
  submitted: Object.freeze({ confirm:'confirmed', reject:'rejected', uncertainty:'unknown' }),
  confirmed: Object.freeze({ settle:'settled', uncertainty:'unknown' }),
  unknown: Object.freeze({ reconcile_open:'confirmed', reconcile_closed:'settled', reconcile_rejected:'rejected' }),
  rejected: Object.freeze({}),
  settled: Object.freeze({})
});
export function nextExecutionState(current, event) {
  if (!EXECUTION_STATES.includes(current)) throw Error('INVALID_EXECUTION_STATE');
  const next = transitions[current][event];
  if (!Object.hasOwn(transitions[current], event) || !next) throw Error('INVALID_EXECUTION_TRANSITION');
  return next;
}
export function classifyBrokerOutcome({ phase, response, error }) {
  if (phase !== 'pre_submit' && phase !== 'post_submit') throw Error('INVALID_PHASE');
  if (phase === 'pre_submit') return { event: 'cancel', reason: 'NOT_SUBMITTED' };
  // Once a buy may have reached Deriv, even a network error or timeout is ambiguous.
  if (error || !response) return { event: 'uncertainty', reason: 'BROKER_OUTCOME_UNKNOWN' };
  const contractId = response?.buy?.contract_id;
  if (contractId !== undefined && contractId !== null && /^[0-9]{1,30}$/.test(String(contractId)))
    return { event: 'confirm', contractId: String(contractId) };
  // A broker error does not necessarily prove that a submitted buy did not execute.
  return { event: 'uncertainty', reason: 'BROKER_OUTCOME_UNKNOWN' };
}
export function reconciliationDecision({ state, brokerEvidence }) {
  if (state !== 'unknown') throw Error('RECONCILIATION_NOT_REQUIRED');
  if (!brokerEvidence || brokerEvidence.verified !== true || brokerEvidence.accountMode !== 'demo')
    return { resolved: false, reason: 'VERIFIED_DEMO_EVIDENCE_REQUIRED' };
  if (brokerEvidence.status === 'open' && /^[0-9]{1,30}$/.test(String(brokerEvidence.contractId || '')))
    return { resolved: true, event: 'reconcile_open', contractId: String(brokerEvidence.contractId) };
  if (brokerEvidence.status === 'closed' && /^[0-9]{1,30}$/.test(String(brokerEvidence.contractId || '')))
    return { resolved: true, event: 'reconcile_closed', contractId: String(brokerEvidence.contractId) };
  // 'Not found' is NOT proof of non-execution: API history may be delayed or incomplete.
  return { resolved: false, reason: 'BROKER_OUTCOME_UNRESOLVED' };
}
export function canSubmitBrokerOrder({ persistedState, accountMode, verifiedAccount, auditPersisted, killSwitch }) {
  return persistedState === 'submitted' && accountMode === 'demo' &&
    verifiedAccount === true && auditPersisted === true && killSwitch === false;
}
