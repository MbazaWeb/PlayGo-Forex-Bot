import { readRealHistory, readRealPortfolio } from '../../../trading/execute.js';

function realAccount(account) {
  return account?.account_type === 'real' &&
    typeof account.account_id === 'string' &&
    /^[A-Za-z0-9_-]{3,80}$/.test(account.account_id);
}

export async function readPortfolio({ account, token, appId, fetchImpl = fetch }) {
  if (!realAccount(account)) return { status: 403, body: { error: 'REAL_ACCOUNT_REQUIRED' } };
  const body = await readRealPortfolio({ account, token, appId, fetchImpl });
  return { status: 200, body };
}

export async function readHistory({ account, token, appId, fetchImpl = fetch }) {
  if (!realAccount(account)) return { status: 403, body: { error: 'REAL_ACCOUNT_REQUIRED' } };
  const body = await readRealHistory({ account, token, appId, fetchImpl });
  return { status: 200, body };
}
