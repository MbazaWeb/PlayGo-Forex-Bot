import {reserveDemoIntent} from './reservation.js';
import {atomicDemoTransition} from './atomic-worker.js';
import {classifyBrokerOutcome} from './execution-state.js';

// Qualification harness. Production callers have no order transport.
// The test broker is supplied by an in-process fixture.
export async function qualifyDemoExecution(input,{reserve=reserveDemoIntent,transition=atomicDemoTransition,testBroker}={}) {
  if (input.env?.PLAYGO_ENV !== 'test' || input.env?.LIVE_TRADING_ENABLED !== 'false' || !testBroker)
    throw Error('BROKER_SUBMISSION_DISABLED');
  const reservation=await reserve(input);
  if (!reservation.accepted) return reservation;
  const intentId=reservation.reservationId;
  const change=(event,contractId)=>transition({intentId,event,brokerContractId:contractId,env:input.env});
  // A claim must commit before a purchase can be attempted. Failure stops here.
  await change('submit');
  let outcome;
  try {
    const response=await testBroker(input.intent);
    outcome=classifyBrokerOutcome({phase:'post_submit',response});
  } catch (error) {
    outcome=classifyBrokerOutcome({phase:'post_submit',error});
  }
  // If persistence fails, the submitted checkpoint survives for recovery.
  return change(outcome.event,outcome.contractId);
}
