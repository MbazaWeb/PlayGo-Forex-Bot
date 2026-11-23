export function isDerivAccount(account) {
  return ['demo', 'real'].includes(account?.account_type) &&
    typeof account.account_id === 'string' &&
    /^[A-Za-z0-9_-]{3,80}$/.test(account.account_id);
}

export function canTradeAccount(account, env) {
  return isDerivAccount(account) &&
    (account.account_type === 'demo' || env.LIVE_TRADING_ENABLED === 'true');
}
