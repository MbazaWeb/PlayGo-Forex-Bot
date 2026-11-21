import test from 'node:test';
import assert from 'node:assert/strict';
import { nextExecutionState, classifyBrokerOutcome, reconciliationDecision, canSubmitBrokerOrder } from './execution-state.js';
test('normal demo lifecycle', () => {
  assert.equal(nextExecutionState('reserved','submit'),'submitted');
  assert.equal(nextExecutionState('submitted','confirm'),'confirmed');
  assert.equal(nextExecutionState('confirmed','settle'),'settled');
});
test('unknown is sticky until independently reconciled', () => {
  assert.equal(nextExecutionState('submitted','uncertainty'),'unknown');
  assert.throws(()=>nextExecutionState('unknown','submit'),/INVALID_EXECUTION_TRANSITION/);
  assert.equal(nextExecutionState('unknown','reconcile_open'),'confirmed');
});
test('settled or rejected orders cannot resubmit', () => {
  assert.throws(()=>nextExecutionState('settled','submit'));
  assert.throws(()=>nextExecutionState('rejected','submit'));
});
test('timeout after submit stays unknown', () => {
  assert.equal(classifyBrokerOutcome({phase:'post_submit',error:new Error('timeout')}).event,'uncertainty');
});
test('missing or ambiguous broker reply stays unknown', () => {
  assert.equal(classifyBrokerOutcome({phase:'post_submit',response:{error:{code:'Error'}}}).event,'uncertainty');
});
test('confirmed buy needs a broker contract id', () => {
  assert.deepEqual(classifyBrokerOutcome({phase:'post_submit',response:{buy:{contract_id:12345}}}),{event:'confirm',contractId:'12345'});
});
test('unverified and real-account evidence cannot reconcile', () => {
  assert.equal(reconciliationDecision({state:'unknown',brokerEvidence:{verified:false,status:'closed',contractId:'123',accountMode:'demo'}}).resolved,false);
  assert.equal(reconciliationDecision({state:'unknown',brokerEvidence:{verified:true,status:'closed',contractId:'123',accountMode:'real'}}).resolved,false);
});
test('not found cannot be treated as rejected', () => {
  assert.equal(reconciliationDecision({state:'unknown',brokerEvidence:{verified:true,status:'not_found',accountMode:'demo'}}).resolved,false);
});
test('verified closed contract can settle unknown', () => {
  assert.equal(reconciliationDecision({state:'unknown',brokerEvidence:{verified:true,status:'closed',contractId:'12345',accountMode:'demo'}}).event,'reconcile_closed');
});
test('broker submission requires every gate', () => {
  const valid={persistedState:'submitted',accountMode:'demo',verifiedAccount:true,auditPersisted:true,killSwitch:false};
  assert.equal(canSubmitBrokerOrder(valid),true);
  for (const patch of [{persistedState:'reserved'},{accountMode:'real'},{verifiedAccount:false},{auditPersisted:false},{killSwitch:true}])
    assert.equal(canSubmitBrokerOrder({...valid,...patch}),false);
});
