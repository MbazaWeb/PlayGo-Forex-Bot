import { evaluateEmergencyStop } from './execution-risk.js';

export async function runEmergencyCheck({
  account,
  control,
  portfolio,
  pause,
  closeContracts,
}) {
  if (account?.account_type !== 'real' || !control || !portfolio ||
      typeof pause !== 'function' || typeof closeContracts !== 'function')
    throw Error('EMERGENCY_CHECK_CONTEXT_REQUIRED');

  const balance = Number(account.balance);
  const openProfit = portfolio.contracts.reduce((sum, contract) => sum + contract.profit, 0);
  const decision = evaluateEmergencyStop({
    startingBalance: Number(control.starting_balance),
    balance,
    openProfit,
  });
  if (!decision.verified) return { status: 'blocked', reason: decision.reason };
  if (!decision.stopped) {
    return {
      status: 'watching',
      equity: decision.equity,
      startingBalance: Number(control.starting_balance),
      drawdownPercent: decision.drawdownPercent,
    };
  }

  let pauseError = null;
  try {
    await pause();
  } catch (error) {
    pauseError = error;
  }
  let closeResults;
  try {
    closeResults = portfolio.contracts.length
      ? await closeContracts(portfolio.contracts.map(contract => contract.id))
      : [];
  } catch (error) {
    return {
      status: 'error',
      reason: 'CLOSE_REQUEST_FAILED',
      pausePersisted: pauseError === null,
      pauseError: pauseError?.code || pauseError?.message || null,
      closeError: error.code || error.message || 'CLOSE_REQUEST_FAILED',
      equity: decision.equity,
      startingBalance: Number(control.starting_balance),
      drawdownPercent: decision.drawdownPercent,
    };
  }
  return {
    status: pauseError ? 'error' : 'stopped',
    reason: pauseError ? 'PAUSE_PERSISTENCE_FAILED' : 'DRAWDOWN_LIMIT',
    pausePersisted: pauseError === null,
    pauseError: pauseError?.code || pauseError?.message || null,
    equity: decision.equity,
    startingBalance: Number(control.starting_balance),
    drawdownPercent: decision.drawdownPercent,
    closeResults,
  };
}
