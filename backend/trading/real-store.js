import { databaseKey, databaseRoot } from './database-url.js';

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
  intentId, event, contractId, env = process.env, fetchImpl = fetch,
}) {
  return rpc('playgo_real_transition', {
    p_intent_id: intentId,
    p_event: event,
    p_contract_id: contractId ?? null,
  }, { env, fetchImpl });
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

export async function recordOrderStrategy({ accountId, intentId, strategy, score, env = process.env, fetchImpl = fetch }) {
  await request(env, 'playgo_real_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, intent_id: intentId, event_type: 'ORDER_STRATEGY',
      event_data: { strategy, score },
    }),
  }, fetchImpl);
}

export async function readTradeEvidence({ accountId, contractIds, env = process.env, fetchImpl = fetch }) {
  const ids = [...new Set(contractIds.filter(id => typeof id === 'string' && /^[0-9]{1,30}$/.test(id)))].slice(0, 25);
  if (!ids.length) return {};
  const intentQuery = new URLSearchParams({
    account_id: 'eq.' + accountId, broker_contract_id: 'in.(' + ids.join(',') + ')',
    select: 'id,broker_contract_id,symbol,contract_type,duration',
  });
  const exitQuery = new URLSearchParams({
    account_id: 'eq.' + accountId, event_type: 'eq.EXIT_TARGET_CHECK',
    select: 'created_at,event_data', order: 'created_at.desc,id.desc', limit: '500',
  });
  const [intents, exits] = await Promise.all([
    request(env, 'playgo_real_intents?' + intentQuery, {}, fetchImpl),
    request(env, 'playgo_real_audit?' + exitQuery, {}, fetchImpl),
  ]);
  const evidence = Object.fromEntries(ids.map(id => [id, {}]));
  const intentById = new Map();
  for (const row of intents) {
    if (!Object.hasOwn(evidence, row.broker_contract_id)) continue;
    const entry = evidence[row.broker_contract_id];
    Object.assign(entry, { symbol: row.symbol, direction: row.contract_type, duration: row.duration });
    intentById.set(row.id, entry);
  }
  if (intentById.size) {
    const strategyQuery = new URLSearchParams({
      account_id: 'eq.' + accountId, event_type: 'eq.ORDER_STRATEGY',
      intent_id: 'in.(' + [...intentById.keys()].join(',') + ')',
      select: 'intent_id,event_data',
    });
    const strategies = await request(env, 'playgo_real_audit?' + strategyQuery, {}, fetchImpl);
    for (const row of strategies) {
      const entry = intentById.get(row.intent_id);
      if (entry) Object.assign(entry, { strategy: row.event_data?.strategy, score: row.event_data?.score });
    }
  }
  for (const row of exits) {
    for (const check of row.event_data?.checks ?? []) {
      if (!Object.hasOwn(evidence, check.contractId)) continue;
      const entry = evidence[check.contractId];
      if (!entry.exit || (check.outcome === 'CLOSED' && entry.exit.outcome !== 'CLOSED')) {
        entry.exit = { outcome: check.outcome, profit: check.profit, canSell: check.canSell, checkedAt: row.created_at };
      }
    }
  }
  return evidence;
}
