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
