import { createHmac } from 'node:crypto';
import { readRealPortfolio } from '../../trading/execute.js';
import { recordAccountSelection } from '../../trading/real-store.js';
import { isDerivAccount } from '../../trading/agents/account/index.js';

function codedError(code) {
  const error = Error(code);
  error.code = code;
  return error;
}

export function accountReference(token, accountId) {
  if (typeof token !== 'string' || !token || typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(accountId))
    throw codedError('INVALID_ACCOUNT_REFERENCE');
  return createHmac('sha256', token).update(accountId).digest('base64url').slice(0, 22);
}

export function publicAccount(account, token) {
  return {
    accountRef: accountReference(token, account.account_id),
    maskedAccountId: '...' + account.account_id.slice(-4),
    account_type: account.account_type,
    currency: account.currency,
    balance: account.balance,
  };
}

export function publicAgentResult(result, accountRef) {
  const safeResult = { ...result };
  delete safeResult.accountId;
  return { ...safeResult, accountRef };
}

export function publicAccountBody(body, accountRef) {
  const safeBody = { ...body };
  delete safeBody.accountId;
  return { ...safeBody, accountRef };
}

export function resolveActiveAccount(session, accounts) {
  if (typeof session?.activeAccountId !== 'string') return null;
  return accounts.find((account) => isDerivAccount(account) && account.account_id === session.activeAccountId) || null;
}

export async function activateAccount({
  session,
  accounts,
  accountRef,
  token,
  confirmReal = false,
  appId,
  env = process.env,
  fetchImpl = fetch,
  Socket,
}) {
  const next = accounts.find(
    (account) => isDerivAccount(account) && accountReference(token, account.account_id) === accountRef
  );
  if (!isDerivAccount(next)) throw codedError('ACCOUNT_REFERENCE_NOT_FOUND');
  if (next.account_type === 'real' && confirmReal !== true) throw codedError('REAL_ACCOUNT_CONFIRMATION_REQUIRED');

  const current = resolveActiveAccount(session, accounts);
  if (typeof session?.activeAccountId === 'string' && !current) throw codedError('ACTIVE_ACCOUNT_UNAVAILABLE');
  if (current && current.account_id !== next.account_id) {
    let portfolio;
    try {
      portfolio = await readRealPortfolio({ account: current, token, appId, fetchImpl, Socket });
    } catch {
      throw codedError('ACTIVE_ACCOUNT_STATUS_UNAVAILABLE');
    }
    if (portfolio.contracts.length) throw codedError('ACCOUNT_SWITCH_OPEN_POSITIONS');
  }

  if (next.account_type === 'real') {
    await recordAccountSelection({
      accountId: next.account_id,
      accountReference: '...' + next.account_id.slice(-4),
      previousAccountType: current?.account_type ?? null,
      env,
      fetchImpl,
    });
  }

  session.activeAccountId = next.account_id;
  return next;
}
