import { databaseKey, databaseRoot } from './database-url.js';
import { redactDiagnosticText } from '../../shared/diagnostic-log.js';

function configuration(env) {
  const url = databaseRoot(env);
  const key = databaseKey(env) || '';
  if (!url || key.length < 24) throw Error('REAL_EXECUTION_DATABASE_NOT_CONFIGURED');
  return { url: url.replace(/\/$/, ''), key };
}

async function request(env, path, init = {}, fetchImpl = fetch) {
  const db = configuration(env);
  const response = await fetchImpl(db.url + '/' + path, {
    ...init,
    redirect: 'error',
    headers: {
      apikey: db.key,
      Authorization: 'Bearer ' + db.key,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error('REAL_EXECUTION_DATABASE_FAILED_' + response.status);
  if (response.status === 204) return null;
  return response.json();
}

async function rpc(name, args, options) {
  return request(options.env, 'rpc/' + name, {
    method: 'POST',
    body: JSON.stringify(args),
  }, options.fetchImpl);
}

export async function readRealControl({ accountId, env = process.env, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(accountId || '')) throw Error('INVALID_ACCOUNT_ID');
  const query = new URLSearchParams({
    account_id: 'eq.' + accountId,
    select: 'account_id,starting_balance,active,paused,stop_reason,stop_loss_percent,take_profit_percent,updated_at',
    limit: '1',
  });
  const rows = await request(env, 'playgo_real_controls?' + query, {}, fetchImpl);
  if (!Array.isArray(rows)) throw Error('INVALID_REAL_CONTROL_RESPONSE');
  return rows[0] || null;
}

export async function startRealControl({
  accountId,
  balance,
  stopLossPercent,
  takeProfitPercent,
  env = process.env,
  fetchImpl = fetch,
}) {
  return rpc('playgo_real_configure_control', {
    p_account_id: accountId,
    p_balance: balance,
    p_stop_loss_percent: stopLossPercent,
    p_take_profit_percent: takeProfitPercent,
  }, { env, fetchImpl });
}

export async function stopRealControl({ accountId, env = process.env, fetchImpl = fetch }) {
  return rpc('playgo_real_stop_control', { p_account_id: accountId }, { env, fetchImpl });
}

export async function pauseRealControl({ accountId, reason, env = process.env, fetchImpl = fetch }) {
  return rpc('playgo_real_pause_control', {
    p_account_id: accountId,
    p_reason: reason,
  }, { env, fetchImpl });
}

export async function reserveRealIntent({ record, env = process.env, fetchImpl = fetch }) {
  return rpc('playgo_real_reserve_intent', { p_record: record }, { env, fetchImpl });
}

export async function transitionRealIntent({
  intentId, event, contractId, transactionId, buyPrice, env = process.env, fetchImpl = fetch,
}) {
  return rpc('playgo_real_transition', {
    p_intent_id: intentId,
    p_event: event,
    p_contract_id: contractId ?? null,
    p_transaction_id: transactionId ?? null,
    p_buy_price: buyPrice ?? null,
  }, { env, fetchImpl });
}

export async function recordAccountSelection({
  accountId, accountReference, previousAccountType, env = process.env, fetchImpl = fetch,
}) {
  await request(env, 'playgo_real_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId,
      event_type: 'ACCOUNT_SELECTED',
      event_data: { account_reference: accountReference, previous_account_type: previousAccountType },
    }),
  }, fetchImpl);
}

export async function readAutoStartPreference({ accountId, accountType = 'real', env = process.env, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(accountId || '')) throw Error('INVALID_ACCOUNT_ID');
  const query = new URLSearchParams({
    account_id: 'eq.' + accountId,
    select: 'auto_start_enabled',
    limit: '1',
  });
  const rows = await request(env, 'playgo_account_settings?' + query, {}, fetchImpl);
  if (!Array.isArray(rows)) throw Error('INVALID_ACCOUNT_SETTINGS_RESPONSE');
  // Demo scanning starts on page load unless this account explicitly opted out.
  // Real accounts always require an explicit opt-in.
  return rows.length ? rows[0].auto_start_enabled === true : accountType === 'demo';
}

export async function writeAutoStartPreference({
  accountId, enabled, env = process.env, fetchImpl = fetch,
}) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(accountId || '') || typeof enabled !== 'boolean')
    throw Error('INVALID_ACCOUNT_SETTINGS');
  await request(env, 'playgo_account_settings?on_conflict=account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      account_id: accountId,
      auto_start_enabled: enabled,
      updated_at: new Date().toISOString(),
    }),
  }, fetchImpl);
}

export async function recordSettlementEvidence({
  accountId, transactions, env = process.env, fetchImpl = fetch,
}) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(accountId || '') || !Array.isArray(transactions))
    throw Error('INVALID_SETTLEMENT_EVIDENCE');
  for (const transaction of transactions) {
    if (!/^[0-9]{1,30}$/.test(transaction?.contractId || '') ||
        !/^[0-9]{1,30}$/.test(transaction?.id || '') ||
        !Number.isFinite(transaction.buy) || transaction.buy < 0 ||
        !Number.isFinite(transaction.sell) || transaction.sell < 0 ||
        !Number.isSafeInteger(transaction.settledAt) || transaction.settledAt <= 0)
      continue;
    const outcome = transaction.sell >= transaction.buy ? 'won' : 'lost';
    const query = new URLSearchParams({
      account_id: 'eq.' + accountId,
      broker_contract_id: 'eq.' + transaction.contractId,
      settled_at: 'is.null',
      select: 'id',
    });
    const updated = await request(env, 'playgo_real_intents?' + query, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        broker_settlement_transaction_id: transaction.id,
        buy_price: transaction.buy,
        sell_price: transaction.sell,
        outcome,
        settled_at: new Date(transaction.settledAt * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }, fetchImpl);
    if (!Array.isArray(updated)) throw Error('INVALID_SETTLEMENT_UPDATE_RESPONSE');
    if (updated.length) {
      await request(env, 'playgo_real_audit', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          account_id: accountId,
          event_type: 'SETTLEMENT_RECONCILED',
          event_data: {
            contract_id: transaction.contractId,
            transaction_id: transaction.id,
            buy: transaction.buy,
            sell: transaction.sell,
            outcome,
            settled_at: new Date(transaction.settledAt * 1000).toISOString(),
          },
        }),
      }, fetchImpl);
    }
  }
}

export async function recordExitCheck({ accountId, checks, env = process.env, fetchImpl = fetch }) {
  await request(env, 'playgo_real_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId,
      event_type: 'EXIT_TARGET_CHECK',
      event_data: { checks },
    }),
  }, fetchImpl);
}

export async function recordCloseResult({
  accountId, contractId, outcome, closeStatus, transactionId, soldFor, stake, reason,
  requestedAt, confirmedAt, env = process.env, fetchImpl = fetch,
}) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(accountId || '') ||
      !/^[0-9]{1,30}$/.test(contractId || '') ||
      (transactionId != null && !/^[0-9]{1,30}$/.test(transactionId)) ||
      !['won', 'lost', 'unconfirmed'].includes(outcome) ||
      !['confirmed', 'unconfirmed'].includes(closeStatus))
    throw Error('INVALID_CLOSE_AUDIT');
  await request(env, 'playgo_real_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId,
      event_type: 'CLOSE_RESULT',
      event_data: {
        contract_id: contractId,
        outcome,
        close_status: closeStatus,
        transaction_id: transactionId ?? null,
        sold_for: Number.isFinite(soldFor) ? soldFor : null,
        stake: Number.isFinite(stake) ? stake : null,
        reason: typeof reason === 'string' ? reason : null,
        requested_at: requestedAt,
        confirmed_at: confirmedAt,
      },
    }),
  }, fetchImpl);
}

export async function recordOrderStrategy({
  accountId, intentId, strategyId, strategy, score, technical = null, exitSettings = null,
  decisionAt, accountReference,
  env = process.env, fetchImpl = fetch,
}) {
  if (typeof strategyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _()+/-]{0,79}$/.test(strategyId) ||
      typeof strategy !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _()+/-]{0,79}$/.test(strategy) ||
      !Number.isFinite(Date.parse(decisionAt)) ||
      !/^\.\.\.[A-Za-z0-9_-]{4}$/.test(accountReference || ''))
    throw Error('INVALID_ORDER_STRATEGY');
  await request(env, 'playgo_real_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, intent_id: intentId, event_type: 'ORDER_STRATEGY',
      event_data: { strategyId, strategy, score, technical, exitSettings, decisionAt, accountReference },
    }),
  }, fetchImpl);
}

export async function recordAgentFailure({
  accountId, status, reason, symbol, granularity, automatic,
  stage = null, nextAction = null, observedAt = new Date().toISOString(), intentId = null,
  env = process.env, fetchImpl = fetch,
}) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(accountId || '') ||
      !['blocked', 'error', 'watching'].includes(status) ||
      !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(reason || '') ||
      (intentId !== null && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(intentId)) ||
      !Number.isFinite(Date.parse(observedAt)) ||
      (stage !== null && !/^[A-Za-z][A-Za-z ]{0,39}$/.test(stage)) ||
      (nextAction !== null && (typeof nextAction !== 'string' ||
        !/^[\x20-\x7E]{1,240}$/.test(nextAction))))
    throw Error('INVALID_AGENT_FAILURE_AUDIT');
  await request(env, 'playgo_real_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId,
      intent_id: intentId,
      event_type: 'AGENT_FAILURE',
      event_data: {
        status,
        reason,
        symbol: /^[A-Za-z0-9_]{2,30}$/.test(symbol || '') ? symbol : null,
        granularity: Number.isSafeInteger(granularity) ? granularity : null,
        mode: automatic ? 'automatic' : 'manual',
        stage,
        nextAction,
        observedAt: new Date(observedAt).toISOString(),
      },
    }),
  }, fetchImpl);
}

export async function recordBrowserConsoleLogs({
  accountId, accountReference, entries, requestId = null, env = process.env, fetchImpl = fetch,
}) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(accountId || '') ||
      !/^[A-Za-z0-9_-]{20,30}$/.test(accountReference || '') ||
      !Array.isArray(entries) || entries.length < 1 || entries.length > 20 ||
      (requestId !== null && (typeof requestId !== 'string' || requestId.length > 128)))
    throw Error('INVALID_BROWSER_DIAGNOSTICS');

  const rows = entries.map(entry => {
    if (!['warn', 'error'].includes(entry?.level) ||
        typeof entry.message !== 'string' || !entry.message.trim() || entry.message.length > 1000)
      throw Error('INVALID_BROWSER_DIAGNOSTIC_ENTRY');
    if (typeof entry.path !== 'string' || !/^\/[A-Za-z0-9/_-]{0,160}$/.test(entry.path) ||
        typeof entry.clientTime !== 'string' || !Number.isFinite(Date.parse(entry.clientTime)))
      throw Error('INVALID_BROWSER_DIAGNOSTIC_ENTRY');
    return {
      account_id: accountId,
      event_type: 'BROWSER_CONSOLE',
      event_data: {
        level: entry.level,
        message: redactDiagnosticText(entry.message, 1000),
        path: entry.path,
        client_time: new Date(entry.clientTime).toISOString(),
        account_reference: accountReference,
        request_id: requestId,
      },
    };
  });
  await request(env, 'playgo_real_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  }, fetchImpl);
  return { recorded: rows.length };
}

export async function readTradeEvidence({
  accountId, contractIds, from, to, env = process.env, fetchImpl = fetch,
}) {
  const hasWindow = from !== undefined || to !== undefined;
  if (hasWindow && (!Number.isSafeInteger(from) || from <= 0 ||
      !Number.isSafeInteger(to) || to < from || to >= 1e11))
    throw Error('INVALID_TRADE_EVIDENCE_RANGE');
  const ids = [...new Set(contractIds.filter(id => typeof id === 'string' && /^[0-9]{1,30}$/.test(id)))];
  if (!ids.length) return {};
  if (ids.length > 10_000) throw Error('TRADE_EVIDENCE_LIMIT');
  const evidence = Object.fromEntries(ids.map(id => [id, {}]));
  const accountFilter = { account_id: 'eq.' + accountId };
  const timeFilter = hasWindow
    ? { and: '(created_at.gte.' + new Date(from * 1000).toISOString() +
      ',created_at.lte.' + new Date(to * 1000).toISOString() + ')' }
    : {};
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const intentQuery = new URLSearchParams({
      ...accountFilter, broker_contract_id: 'in.(' + batch.join(',') + ')',
      select: 'id,broker_contract_id,symbol,contract_type,duration,stake,status,strategy_id,strategy_label,score,decision_at,account_reference,broker_transaction_id,broker_settlement_transaction_id,buy_price,sell_price,outcome,settled_at,created_at,updated_at',
    });
    const intents = await request(env, 'playgo_real_intents?' + intentQuery, {}, fetchImpl);
    const intentById = new Map();
    for (const row of intents) {
      if (!Object.hasOwn(evidence, row.broker_contract_id)) continue;
      const entry = evidence[row.broker_contract_id];
      Object.assign(entry, { symbol: row.symbol, direction: row.contract_type, duration: row.duration });
      entry.execution = {
        intentId: row.id,
        status: row.status,
        stake: Number(row.stake),
        strategyId: row.strategy_id,
        strategy: row.strategy_label,
        score: row.score === null ? null : Number(row.score),
        decisionAt: row.decision_at,
        accountReference: row.account_reference,
        transactionId: row.broker_transaction_id,
        settlementTransactionId: row.broker_settlement_transaction_id,
        buy: row.buy_price === null ? null : Number(row.buy_price),
        sell: row.sell_price === null ? null : Number(row.sell_price),
        outcome: row.outcome || 'unconfirmed',
        settledAt: row.settled_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      intentById.set(row.id, entry);
    }
    if (!intentById.size) continue;
    const strategyQuery = new URLSearchParams({
      ...accountFilter, event_type: 'eq.ORDER_STRATEGY',
      intent_id: 'in.(' + [...intentById.keys()].join(',') + ')',
      select: 'intent_id,event_data', order: 'id.asc',
    });
    for await (const row of auditRows(strategyQuery, env, fetchImpl)) {
      const entry = intentById.get(row.intent_id);
      if (entry) Object.assign(entry, {
        strategyId: row.event_data?.strategyId ?? entry.execution?.strategyId,
        strategy: row.event_data?.strategy,
        score: row.event_data?.score,
        technical: row.event_data?.technical ?? null,
        exitSettings: row.event_data?.exitSettings ?? null,
      });
    }
    const lifecycleQuery = new URLSearchParams({
      ...accountFilter,
      intent_id: 'in.(' + [...intentById.keys()].join(',') + ')',
      event_type: 'in.(INTENT_RESERVED,ORDER_SUBMIT,ORDER_CONFIRM,ORDER_REJECT,ORDER_UNKNOWN)',
      select: 'intent_id,event_type,event_data,created_at',
      order: 'id.asc',
    });
    for await (const row of auditRows(lifecycleQuery, env, fetchImpl)) {
      const entry = intentById.get(row.intent_id);
      if (entry) {
        entry.lifecycle ??= [];
        entry.lifecycle.push({
          event: row.event_type,
          data: row.event_data,
          recordedAt: row.created_at,
        });
      }
    }
  }
  const exitQuery = new URLSearchParams({
    ...accountFilter, ...timeFilter, event_type: 'eq.EXIT_TARGET_CHECK',
    select: 'created_at,event_data', order: 'id.desc',
  });
  const confirmed = new Set();
  for await (const row of auditRows(exitQuery, env, fetchImpl)) {
    for (const check of row.event_data?.checks ?? []) {
      if (!Object.hasOwn(evidence, check.contractId)) continue;
      const entry = evidence[check.contractId];
      if (!entry.exit || (check.outcome === 'CLOSED' && entry.exit.outcome !== 'CLOSED') ||
          (check.outcome === 'CLOSED' && Number.isFinite(check.soldFor) && !Number.isFinite(entry.exit.soldFor))) {
        entry.exit = {
          outcome: check.outcome,
          profit: check.profit,
          canSell: check.canSell,
          soldFor: check.soldFor,
          checkedAt: row.created_at,
        };
      }
      if (check.outcome === 'CLOSED') confirmed.add(check.contractId);
    }
    if (confirmed.size === ids.length) break;
  }
  const closeQuery = new URLSearchParams({
    ...accountFilter, ...timeFilter, event_type: 'eq.CLOSE_RESULT',
    select: 'created_at,event_data', order: 'id.desc',
  });
  const closes = new Set();
  for await (const row of auditRows(closeQuery, env, fetchImpl)) {
    const contractId = row.event_data?.contract_id;
    if (!Object.hasOwn(evidence, contractId) || closes.has(contractId)) continue;
    evidence[contractId].close = {
      status: row.event_data?.close_status,
      outcome: row.event_data?.outcome,
      transactionId: row.event_data?.transaction_id ?? null,
      soldFor: row.event_data?.sold_for,
      reason: row.event_data?.reason,
      requestedAt: row.event_data?.requested_at,
      confirmedAt: row.event_data?.confirmed_at,
      recordedAt: row.created_at,
    };
    closes.add(contractId);
    if (closes.size === ids.length) break;
  }
  return evidence;
}

export async function readAgentFailures({ accountId, from, to, limit = 5000, env = process.env, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(accountId || '') ||
      !Number.isSafeInteger(from) || from <= 0 ||
      !Number.isSafeInteger(to) || to < from ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
    throw Error('INVALID_AGENT_FAILURE_RANGE');
  const query = new URLSearchParams({
    account_id: 'eq.' + accountId,
    event_type: 'in.(AGENT_FAILURE,ORDER_REJECT,ORDER_UNKNOWN,CLOSE_RESULT,BROWSER_CONSOLE)',
    and: '(created_at.gte.' + new Date(from * 1000).toISOString() +
      ',created_at.lte.' + new Date(to * 1000).toISOString() + ')',
    select: 'intent_id,event_type,event_data,created_at',
    order: 'id.desc',
  });
  const rows = [];
  let complete = true;
  for await (const row of auditRows(query, env, fetchImpl)) {
    rows.push(row);
    if (rows.length > limit) {
      rows.pop();
      complete = false;
      break;
    }
  }
  const intentIds = [...new Set(rows
    .map(row => row.intent_id)
    .filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))];
  const rejectedIntentIds = new Set(rows
    .filter(row => row.event_type === 'ORDER_REJECT' && typeof row.intent_id === 'string')
    .map(row => row.intent_id));
  const rejectionDetails = new Map();
  for (const row of rows) {
    if (row.event_type === 'AGENT_FAILURE' && typeof row.intent_id === 'string' &&
        rejectedIntentIds.has(row.intent_id) && !rejectionDetails.has(row.intent_id))
      rejectionDetails.set(row.intent_id, row);
  }
  const intents = new Map();
  for (let offset = 0; offset < intentIds.length; offset += 100) {
    const batch = intentIds.slice(offset, offset + 100);
    const intentQuery = new URLSearchParams({
      account_id: 'eq.' + accountId,
      id: 'in.(' + batch.join(',') + ')',
      select: 'id,symbol,contract_type,duration,stake',
    });
    const intentRows = await request(env, 'playgo_real_intents?' + intentQuery, {}, fetchImpl);
    if (!Array.isArray(intentRows)) throw Error('INVALID_AGENT_FAILURE_INTENTS');
    for (const intent of intentRows) intents.set(intent.id, intent);
  }
  const failures = rows
    .filter(row => !(row.event_type === 'AGENT_FAILURE' &&
      typeof row.intent_id === 'string' && rejectedIntentIds.has(row.intent_id)))
    .map(row => {
    if (row.event_type === 'AGENT_FAILURE')
      return { ...row.event_data, source: 'application', event: row.event_type, recordedAt: row.created_at };
    if (row.event_type === 'BROWSER_CONSOLE')
      return {
        source: 'browser-console',
        event: row.event_type,
        status: row.event_data?.level || 'unknown',
        reason: 'BROWSER_CONSOLE',
        message: row.event_data?.message || 'Unavailable',
        path: row.event_data?.path || 'Unavailable',
        requestId: row.event_data?.request_id || null,
        clientTime: row.event_data?.client_time || null,
        recordedAt: row.created_at,
      };
    if (row.event_type === 'CLOSE_RESULT')
      return {
        source: 'broker',
        event: row.event_type,
        status: row.event_data?.close_status === 'unconfirmed' ? 'error' : 'watching',
        reason: row.event_data?.reason || 'CLOSE_STATUS',
        stage: 'Exit monitoring',
        nextAction: row.event_data?.close_status === 'unconfirmed'
          ? 'Check the broker position before retrying an exit.'
          : 'Continue monitoring until the settlement is reconciled.',
        contractId: row.event_data?.contract_id ?? null,
        outcome: row.event_data?.outcome || 'unconfirmed',
        soldFor: row.event_data?.sold_for ?? null,
        transactionId: row.event_data?.transaction_id ?? null,
        stake: row.event_data?.stake ?? null,
        requestedAt: row.event_data?.requested_at ?? null,
        confirmedAt: row.event_data?.confirmed_at ?? null,
        recordedAt: row.created_at,
      };
    const intent = intents.get(row.intent_id);
    const rejection = rejectionDetails.get(row.intent_id)?.event_data;
    return {
      source: 'broker',
      event: row.event_type,
      status: row.event_type === 'ORDER_UNKNOWN' ? 'error' : 'blocked',
      reason: row.event_type === 'ORDER_UNKNOWN'
        ? 'ORDER_OUTCOME_UNKNOWN'
        : rejection?.reason || 'ORDER_REJECTED',
      symbol: intent?.symbol ?? null,
      direction: intent?.contract_type ?? null,
      duration: intent?.duration ?? null,
      stake: intent ? Number(intent.stake) : null,
      stage: rejection?.stage || (row.event_type === 'ORDER_UNKNOWN' ? 'Buy confirmation' : 'Broker proposal'),
      nextAction: rejection?.nextAction ||
        (row.event_type === 'ORDER_UNKNOWN'
          ? 'Check Deriv open positions and reconciliation before allowing another order.'
          : 'No buy was submitted; inspect the broker response and try another eligible market.'),
      observedAt: rejection?.observedAt ?? row.created_at,
      from: row.event_data?.from ?? null,
      to: row.event_data?.to ?? null,
      mode: null,
      recordedAt: row.created_at,
    };
  });
  return { failures, complete };
}

async function* auditRows(query, env, fetchImpl) {
  const ascending = query.get('order') === 'id.asc';
  query.set('select', query.get('select') + ',id');
  query.set('limit', '500');
  let cursor;
  for (;;) {
    if (cursor !== undefined) query.set('id', (ascending ? 'gt.' : 'lt.') + cursor);
    const rows = await request(env, 'playgo_real_audit?' + query, {}, fetchImpl);
    if (!Array.isArray(rows)) throw Error('INVALID_TRADE_AUDIT');
    if (!rows.length) return;
    const next = rows.at(-1).id;
    if (!Number.isSafeInteger(next) || next <= 0 ||
        (cursor !== undefined && (ascending ? next <= cursor : next >= cursor))) throw Error('INVALID_AUDIT_CURSOR');
    yield* rows;
    cursor = next;
  }
}

export async function readLiveQualification({ accountId, env = process.env, fetchImpl = fetch }) {
  const query = new URLSearchParams({
    account_id: 'eq.' + accountId, limit: '1',
    select: 'account_id,approved_by,approved_at,expires_at,holdout_start,settlements',
  });
  const rows = await request(env, 'playgo_live_qualification?' + query, {}, fetchImpl);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].account_id !== accountId) return null;
  return rows[0];
}
