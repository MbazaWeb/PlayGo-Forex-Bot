import { isDerivAccount } from '../../../trading/deriv-account.js';
import { readRealHistory, readRealPortfolio } from '../../../trading/execute.js';


export async function readPortfolio({ account, token, appId, fetchImpl = fetch }) {
  if (!isDerivAccount(account)) return { status: 403, body: { error: 'REAL_ACCOUNT_REQUIRED' } };
  const body = await readRealPortfolio({ account, token, appId, fetchImpl });
  return { status: 200, body };
}

export async function readHistory({ account, token, appId, fetchImpl = fetch }) {
  if (!isDerivAccount(account)) return { status: 403, body: { error: 'REAL_ACCOUNT_REQUIRED' } };
  const body = await readRealHistory({ account, token, appId, fetchImpl });
  return { status: 200, body };
}
