import { AUTOMATIC_SETUP } from '../../shared/agent-analysis.js';
import { isDerivAccount, canTradeAccount } from './deriv-account.js';
import { createHash } from 'node:crypto';
import { reviewMarket, marketReviewReceipt } from '../../shared/market-review.js';
import { executeRealOrder, readRealPortfolio, closeRealContracts, readRecentSettlements, readSettlementRange } from './execute.js';
import {
  calculateStake,
  qualifyingDirection,
  MAX_OPEN_CONTRACTS,
  contractsAtExitThresholds,
  validExitSettings,
  consecutiveLossHalt,
  dailyRiskState,
  startOfEatDay,
} from './execution-risk.js';
import { readMarketCandles } from './market-data.js';
import {
  pauseRealControl,
  readRealControl,
  recordExitCheck,
  recordOrderStrategy,
  reserveRealIntent,
  startRealControl,
  stopRealControl,
  transitionRealIntent,
} from './real-store.js';
import { runEmergencyCheck } from './emergency-agent.js';

function balanceOf(account) {
  const balance = Number(account?.balance);
  if (!Number.isFinite(balance) || balance <= 0) throw Error('REAL_ACCOUNT_BALANCE_UNAVAILABLE');
  return balance;
}

function publicStatus(error) {
  return error?.code || 'AGENT_OPERATION_FAILED';
}

function agentError(code) {
  const error = Error(code);
  error.code = code;
  return error;
}

export async function startRealAgents({
  accounts,
  stopLossPercent,
  takeProfitPercent,
  env = process.env,
  fetchImpl = fetch,
}) {
  if (!validExitSettings(stopLossPercent, takeProfitPercent))
    throw agentError('INVALID_EXIT_SETTINGS');
  const realAccounts = accounts.filter(isDerivAccount);
  if (!realAccounts.length) throw agentError('REAL_ACCOUNT_REQUIRED');
  if (realAccounts.some(account => !canTradeAccount(account, env)))
    throw agentError('LIVE_TRADING_DISABLED');
  const results = [];
  for (const account of realAccounts) {
    try {
      const state = await startRealControl({
        accountId: account.account_id,
        balance: balanceOf(account),
        stopLossPercent,
        takeProfitPercent,
        env,
        fetchImpl,
      });
      results.push({ accountId: account.account_id, ...state });
    } catch (error) {
      results.push({ accountId: account.account_id, active: false, error: publicStatus(error) });
    }
  }
  return results;
}

export async function stopRealAgents({ accounts, env = process.env, fetchImpl = fetch }) {
  const results = [];
  for (const account of accounts.filter(isDerivAccount)) {
    try {
      const state = await stopRealControl({ accountId: account.account_id, env, fetchImpl });
      results.push({ accountId: account.account_id, ...state });
    } catch (error) {
      results.push({ accountId: account.account_id, active: null, error: publicStatus(error) });
    }
  }
  return results;
}

export async function placeRealAgentOrders({
  accounts,
  token,
  appId,
  symbol,
  granularity,
  automatic = false,
  terminalAction = null,
  stopLossPercent,
  takeProfitPercent,
  env = process.env,
  fetchImpl = fetch,
  Socket,
  now = Date.now,
}) {
  if (terminalAction !== null && !['buy', 'sell', 'bot'].includes(terminalAction))
    throw agentError('INVALID_TERMINAL_ACTION');
  if (terminalAction) {
    stopLossPercent = AUTOMATIC_SETUP.stopLossPercent;
    takeProfitPercent = AUTOMATIC_SETUP.takeProfitPercent;
  }
  if (!validExitSettings(stopLossPercent, takeProfitPercent))
    throw agentError('INVALID_EXIT_SETTINGS');
  if (!/^[A-Za-z0-9_]{2,30}$/.test(symbol || '') ||
      ![60, 300, 900, 3600].includes(granularity))
    throw agentError('INVALID_MARKET_REQUEST');

  const realAccounts = accounts.filter(isDerivAccount);
  if (!realAccounts.length) throw agentError('REAL_ACCOUNT_REQUIRED');
  if (realAccounts.some(account => !canTradeAccount(account, env)))
    throw agentError('LIVE_TRADING_DISABLED');
  const results = [];

  for (const account of realAccounts) {
    let result;
    let wasActive = false;
    let startedForRequest = false;
    let keepActive = false;
    let cleanupFailed = false;
    try {
      const current = await readRealControl({ accountId: account.account_id, env, fetchImpl });
      wasActive = current?.active === true;
      if (current?.paused) {
        result = { status: 'stopped', reason: current.stop_reason || 'AGENT_PAUSED' };
      } else {
        const storedStopLoss = Number(current?.stop_loss_percent);
        const storedTakeProfit = Number(current?.take_profit_percent);
        const storedExitSettingsValid = validExitSettings(storedStopLoss, storedTakeProfit);
        if (!terminalAction && wasActive && storedExitSettingsValid &&
            (storedStopLoss !== stopLossPercent || storedTakeProfit !== takeProfitPercent)) {
          result = { status: 'blocked', reason: 'EXIT_SETTINGS_MISMATCH' };
        } else if (!wasActive || !storedExitSettingsValid) {
          const started = await startRealControl({
            accountId: account.account_id,
            balance: balanceOf(account),
            stopLossPercent,
            takeProfitPercent,
            env,
            fetchImpl,
          });
          if (started?.active !== true) {
            result = { status: 'stopped', reason: started?.reason || 'AGENT_NOT_ACTIVE' };
          } else if (!wasActive) {
            startedForRequest = true;
          }
        }
        if (!result) {
          result = await runRealAgentTick({
            account,
            token,
            appId,
            symbol,
            granularity,
            automatic: terminalAction === "bot" || automatic,
            terminalOrder: Boolean(terminalAction),
            manualDirection: terminalAction === "buy" ? "CALL" : terminalAction === "sell" ? "PUT" : null,
            stopLossPercent,
            takeProfitPercent,
            env,
            fetchImpl,
            Socket,
            now,
          });
        }
      }
    } catch (error) {
      result = { status: 'error', reason: publicStatus(error), detail: error.proposalDetail };
    }

    if (!terminalAction && startedForRequest && result?.status === 'ordered') {
      startedForRequest = false;
      keepActive = true;
    }
    if (startedForRequest) {
      try {
        await stopRealControl({ accountId: account.account_id, env, fetchImpl });
      } catch (error) {
        cleanupFailed = true;
        result = {
          ...result,
          status: 'error',
          reason: 'ONE_SHOT_CLEANUP_FAILED',
          cleanupError: publicStatus(error),
        };
      }
    }
    const automationActive = cleanupFailed
      ? null
      : (wasActive || keepActive) &&
        result.status !== 'idle' && result.status !== 'stopped' &&
        !(result.status === 'blocked' && result.reason === 'LIVE_TRADING_DISABLED');
    results.push({ accountId: account.account_id, ...result, automationActive });
  }
  return results;
}

export async function readRealAgentStatuses({ accounts, env = process.env, fetchImpl = fetch }) {
  const results = [];
  for (const account of accounts.filter(isDerivAccount)) {
    try {
      results.push({
        accountId: account.account_id,
        control: await readRealControl({ accountId: account.account_id, env, fetchImpl }),
      });
    } catch (error) {
      results.push({ accountId: account.account_id, error: publicStatus(error) });
    }
  }
  return results;
}

export async function runRealAgentTick({
  account,
  token,
  appId,
  symbol,
  granularity,
  automatic = false,
  exitsOnly = false,
  marketScan = false,
  terminalOrder = false,
  manualDirection = null,
  env = process.env,
  fetchImpl = fetch,
  Socket,
  now = Date.now,
}) {
  if (!isDerivAccount(account)) return { status: 'blocked', reason: 'REAL_ACCOUNT_REQUIRED' };
  if (!canTradeAccount(account, env)) return { status: 'blocked', reason: 'LIVE_TRADING_DISABLED' };
  if (!/^[A-Za-z0-9_]{2,30}$/.test(symbol || '') ||
      ![60, 300, 900, 3600].includes(granularity))
    return { status: 'blocked', reason: 'INVALID_MARKET_REQUEST' };

  const control = await readRealControl({ accountId: account.account_id, env, fetchImpl });
  if (!control) return { status: 'idle', reason: 'AGENT_NOT_STARTED' };
  if (control.paused && control.stop_reason !== 'DRAWDOWN_LIMIT')
    return { status: 'stopped', reason: control.stop_reason || 'AGENT_PAUSED' };
  if (!control.paused && !control.active) return { status: 'idle', reason: 'AGENT_NOT_ACTIVE' };
  const stopLossPercent = Number(control.stop_loss_percent);
  const takeProfitPercent = Number(control.take_profit_percent);
  if (!validExitSettings(stopLossPercent, takeProfitPercent) &&
      !(control.paused && control.stop_reason === 'DRAWDOWN_LIMIT'))
    return { status: 'blocked', reason: 'INVALID_EXIT_SETTINGS' };

  const balance = balanceOf(account);
  const brokerOptions = { account, token, appId, fetchImpl, Socket };
  const portfolioSnapshotStartedAt = new Date().toISOString();
  const portfolio = await readRealPortfolio(brokerOptions);
  if (control.paused && control.stop_reason === 'DRAWDOWN_LIMIT') {
    const closeResults = portfolio.contracts.length
      ? await closeRealContracts({
        ...brokerOptions,
        contractIds: portfolio.contracts.map(contract => contract.id),
      })
      : [];
    return {
      status: 'stopped',
      reason: 'DRAWDOWN_LIMIT',
      accountId: account.account_id,
      closeResults,
    };
  }
  const emergency = await runEmergencyCheck({
    account,
    control,
    portfolio,
    pause: () => pauseRealControl({
      accountId: account.account_id,
      reason: 'DRAWDOWN_LIMIT',
      env,
      fetchImpl,
    }),
    closeContracts: contractIds => closeRealContracts({ ...brokerOptions, contractIds }),
  });
  if (emergency.status !== 'watching')
    return { ...emergency, accountId: account.account_id };

  const cappedAutomaticUsd = automatic && !terminalOrder && account.currency === 'USD';
  const useUsdTargets = cappedAutomaticUsd || (automatic && (marketScan || exitsOnly) && account.currency === 'USD');
  const usdBreaches = useUsdTargets ? portfolio.contracts.filter(contract =>
    contract.profit <= -AUTOMATIC_SETUP.stopLossUsd || contract.profit >= AUTOMATIC_SETUP.takeProfitUsd
  ) : [];
  const exitContracts = useUsdTargets
    ? usdBreaches.filter(contract => contract.canSell)
    : contractsAtExitThresholds(portfolio.contracts, stopLossPercent, takeProfitPercent);
  let closeResults = [];
  if (exitContracts.length) {
    try {
      closeResults = await closeRealContracts({
        ...brokerOptions,
        contractIds: exitContracts.map(contract => contract.id),
      });
    } catch (error) {
      closeResults = exitContracts.map(contract => ({
        contractId: contract.id, closed: false, reason: error.code || 'CLOSE_CONNECTION_FAILED',
      }));
    }
  }

  if (cappedAutomaticUsd && usdBreaches.length) {
    const outcomes = new Map(closeResults.map(result => [result.contractId, result]));
    const checks = usdBreaches.map(contract => {
      const outcome = outcomes.get(contract.id);
      return {
        contractId: contract.id,
        profit: contract.profit,
        canSell: contract.canSell,
        outcome: !contract.canSell ? 'EARLY_SALE_UNAVAILABLE'
          : outcome?.closed ? 'CLOSED' : outcome?.reason || 'CLOSE_UNCONFIRMED',
      };
    });
    try {
      await recordExitCheck({ accountId: account.account_id, checks, env, fetchImpl });
    } catch {
      console.warn('PlayGo exit audit write failed');
    }
  }

  if (exitContracts.length) {
    return {
      status: 'exited',
      reason: 'CONTRACT_EXIT_THRESHOLD',
      accountId: account.account_id,
      equity: emergency.equity,
      exitContracts: exitContracts.map(contract => ({
        contractId: contract.id,
        profit: contract.profit,
        stake: contract.stake,
      })),
      closeResults,
    };
  }

  if (exitsOnly && cappedAutomaticUsd && usdBreaches.length) {
    return { status: 'watching', reason: 'EARLY_SALE_UNAVAILABLE', accountId: account.account_id };
  }
  if (exitsOnly) return { status: 'watching', reason: 'EXIT_MONITORING', accountId: account.account_id };

  if (portfolio.contracts.length >= MAX_OPEN_CONTRACTS) {
    return {
      status: 'watching',
      reason: 'OPEN_CONTRACT_LIMIT',
      accountId: account.account_id,
      openContracts: portfolio.contracts.length,
      equity: emergency.equity,
      emergency,
    };
  }

  if (automatic && marketScan && portfolio.contracts.some(contract => contract.symbol === symbol)) {
    return { status: 'watching', reason: 'MARKET_ALREADY_OPEN', accountId: account.account_id, symbol };
  }

  const candles = manualDirection ? [] : await readMarketCandles({ symbol, granularity, Socket, now });
  const analysis = manualDirection ? null : reviewMarket(candles, granularity, now(), automatic);
  const contractType = manualDirection || qualifyingDirection(analysis);
  const strategy = analysis?.strategy || (manualDirection ? 'Manual direction' : 'Awaiting market data');
  if (!contractType || analysis?.block) {
    return {
      status: 'watching',
      reason: analysis?.block || 'NO_QUALIFYING_SIGNAL',
      accountId: account.account_id,
      symbol,
      strategy,
      review: marketReviewReceipt(analysis),
      score: analysis.confluenceScore ?? null,
      equity: emergency.equity,
      emergency,
    };
  }

  // Loss-streak cooldown and daily loss cap apply to every entry, manual or automatic.
  const recent = await readRecentSettlements({ ...brokerOptions, limit: 50 });
  const nowEpoch = Math.floor(now() / 1000);
  if (consecutiveLossHalt(recent.transactions, nowEpoch)) {
    return { status: 'watching', reason: 'LOSS_STREAK_COOLDOWN', accountId: account.account_id, equity: emergency.equity };
  }
  const startingBalance = Number(control.starting_balance);
  let daily = dailyRiskState(recent.transactions, {
    nowEpoch, fetchLimit: recent.fetchLimit, startingBalance,
  });
  if (!daily.complete) {
    const today = await readSettlementRange({
      ...brokerOptions, from: startOfEatDay(nowEpoch), to: nowEpoch, maxRows: 1000,
    });
    daily = dailyRiskState(today.transactions, {
      nowEpoch, historyComplete: today.complete, startingBalance,
    });
  }
  if (!daily.complete) {
    return { status: 'watching', reason: 'DAILY_HISTORY_INCOMPLETE', accountId: account.account_id, equity: emergency.equity };
  }
  if (daily.breached) {
    return { status: 'watching', reason: 'DAILY_LOSS_LIMIT', accountId: account.account_id, equity: emergency.equity };
  }

  const calculatedStake = calculateStake(balance, account.currency);
  const stake = cappedAutomaticUsd ? Math.min(calculatedStake, AUTOMATIC_SETUP.stopLossUsd) : calculatedStake;
  if (cappedAutomaticUsd) {
    const openStake = portfolio.contracts.reduce((sum, contract) => sum + Math.round(contract.stake * 100), 0);
    const budget = Math.floor(Math.min(balance, emergency.equity));
    if (openStake + Math.round(stake * 100) > budget) {
      return { status: 'watching', reason: 'OPEN_EXPOSURE_LIMIT', accountId: account.account_id, symbol };
    }
  }
  const duration = granularity / 60;
  const idempotencyKey = createHash('sha256')
    .update([account.account_id, symbol, granularity, analysis?.last.epoch ?? Math.floor(now() / 1000 / granularity) * granularity].join(':'))
    .digest('hex');
  const reservation = await reserveRealIntent({
    record: {
      account_id: account.account_id,
      idempotency_key: idempotencyKey,
      status: 'reserved',
      symbol,
      contract_type: contractType,
      stake,
      duration,
      balance,
      equity: emergency.equity,
      open_count: portfolio.contracts.length,
      portfolio_snapshot_started_at: portfolioSnapshotStartedAt,
    },
    env,
    fetchImpl,
  });
  if (reservation?.accepted !== true) {
    if (reservation?.reason === 'DRAWDOWN_LIMIT' && portfolio.contracts.length) {
      const closeResults = await closeRealContracts({
        ...brokerOptions,
        contractIds: portfolio.contracts.map(contract => contract.id),
      });
      return {
        status: 'stopped',
        reason: 'DRAWDOWN_LIMIT',
        accountId: account.account_id,
        closeResults,
      };
    }
    return {
      status: reservation?.reason === 'DRAWDOWN_LIMIT' ? 'stopped' : 'watching',
      reason: reservation?.reason || 'RESERVATION_UNCONFIRMED',
      accountId: account.account_id,
      equity: emergency.equity,
    };
  }

  let submitTransitionStarted = false;
  let beforeBuyStarted = false;
  try {
    const order = await executeRealOrder({
      ...brokerOptions,
      env,
      intent: { symbol, contractType, stake, duration, durationUnit: 'm' },
      beforeBuy: async () => {
        beforeBuyStarted = true;
        submitTransitionStarted = true;
        await transitionRealIntent({
          intentId: reservation.intentId,
          event: 'submit',
          env,
          fetchImpl,
        });
      },
    });
    await transitionRealIntent({
      intentId: reservation.intentId,
      event: 'confirm',
      contractId: order.contractId,
      env,
      fetchImpl,
    });
    try {
      await recordOrderStrategy({
        accountId: account.account_id, intentId: reservation.intentId,
        strategy: manualDirection ? 'Manual direction' : strategy,
        score: analysis?.confluenceScore ?? null, env, fetchImpl,
      });
    } catch {
      console.warn('PlayGo order strategy audit write failed');
    }
    return {
      status: 'ordered',
      review: marketReviewReceipt(analysis),
      strategy,
      accountId: account.account_id,
      contractId: order.contractId,
      symbol,
      contractType,
      stake,
      score: analysis?.confluenceScore ?? null,
      equity: emergency.equity,
    };
  } catch (error) {
    if (error.code === 'BROKER_ORDER_OUTCOME_UNKNOWN' && submitTransitionStarted) {
      await transitionRealIntent({
        intentId: reservation.intentId,
        event: 'unknown',
        env,
        fetchImpl,
      });
      return { status: 'stopped', reason: 'ORDER_OUTCOME_UNKNOWN', accountId: account.account_id };
    }
    if (!beforeBuyStarted) {
      await transitionRealIntent({
        intentId: reservation.intentId,
        event: 'reject',
        env,
        fetchImpl,
      });
    }
    throw error;
  }
}
