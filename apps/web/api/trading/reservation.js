// Durable demo-only reservation. Internal worker module, NOT a public API route.
// Never place a broker order from this module.
import { assessTrade } from './risk.js';

function requireServerConfig(env) {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || key.length < 24)
    throw Error('DATABASE_NOT_CONFIGURED');
  return { url: url.replace(/\/$/, ''), key };
}
async function request(db, path, init = {}, fetchImpl = fetch) {
  const res = await fetchImpl(db.url + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: db.key, Authorization: 'Bearer ' + db.key,
      'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw Error('DATABASE_OPERATION_FAILED_' + res.status);
  return res.status === 204 ? null : res.json();
}
export async function reserveDemoIntent({ intent, account, state, strategyId, env = process.env, fetchImpl = fetch }) {
  if (env.PLAYGO_DEMO_EXECUTION_ENABLED !== 'true') throw Error('DEMO_EXECUTION_DISABLED');
  const decision = assessTrade({ intent, account, state });
  if (!decision.allowed) return { accepted: false, reason: decision.reason };
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(strategyId || '')) throw Error('INVALID_STRATEGY');
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(account.id || '')) throw Error('INVALID_ACCOUNT_ID');
  const db = requireServerConfig(env);
  const record = {
    idempotency_key: intent.idempotencyKey, account_id: account.id,
    account_mode: 'demo', strategy_id: strategyId,
    symbol: intent.symbol, contract_type: intent.contractType,
    stake: intent.stake, status: 'reserved'
  };
  // DB unique indexes are the concurrency gate. Never retry a failed insert as a new order.
  let rows;
  try {
    rows = await request(db, 'playgo_execution_intents?select=id,idempotency_key,status', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record)
    }, fetchImpl);
  } catch (error) {
    // Including uniqueness conflicts: caller must reconcile, not resubmit.
    return { accepted: false, reason: 'RESERVATION_NOT_CONFIRMED' };
  }
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].status !== 'reserved') {
    return { accepted: false, reason: 'RESERVATION_NOT_CONFIRMED' };
  }
  const reservation = rows[0];
  try {
    await request(db, 'playgo_execution_audit', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ intent_id: reservation.id, event_type: 'DEMO_INTENT_RESERVED',
        event_data: { strategy_id: strategyId, symbol: intent.symbol, contract_type: intent.contractType } })
    }, fetchImpl);
  } catch {
    // An unaudited reservation must remain unresolved. No broker execution permitted.
    return { accepted: false, reason: 'AUDIT_WRITE_FAILED', reservationId: reservation.id };
  }
  return { accepted: true, reservationId: reservation.id, status: 'reserved', brokerExecution: false };
}
