export function normalizeDemoActivity({ accountId, accounts, portfolio, history }) {
  const isAmount = (value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    return /^\d+(\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value));
  };
  const account = Array.isArray(accounts)
    ? accounts.find((row) => row?.account_id === accountId && row?.account_type === 'demo')
    : null;
  if (!account) throw Error('DEMO_ACCOUNT_REQUIRED');
  if (portfolio?.accountId !== accountId || !Array.isArray(portfolio.contracts) ||
      portfolio.contracts.some((row) => !row || typeof row.id !== 'string' ||
        (row.symbol !== null && typeof row.symbol !== 'string'))) {
    throw Error('INVALID_API_RESPONSE');
  }
  if (history?.accountId !== accountId || !Array.isArray(history.transactions) ||
      history.transactions.some((row) => !row || typeof row.id !== 'string' ||
        !isAmount(row.buy) || !isAmount(row.sell))) {
    throw Error('INVALID_API_RESPONSE');
  }
  return {
    account,
    contracts: portfolio.contracts,
    transactions: history.transactions,
    portfolioObservedAt: portfolio.observedAt ?? null,
    historyObservedAt: history.observedAt ?? null,
  };
}
