export function isDerivAccount(account) {
  return ['demo', 'real'].includes(account?.account_type) &&
    typeof account.account_id === 'string' &&
    /^[A-Za-z0-9_-]{3,80}$/.test(account.account_id);
}

// Real money needs two server-side keys: the global switch and an explicit
// confirmation that names this exact account. Changing one token is not enough.
export function canTradeAccount(account, env) {
  if (!isDerivAccount(account)) return false;
  if (account.account_type === 'demo') return true;
  return env.LIVE_TRADING_ENABLED === 'true' && env.LIVE_TRADING_CONFIRM === account.account_id;
}
