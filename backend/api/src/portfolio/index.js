import { isDerivAccount, canTradeAccount } from '../../../trading/deriv-account.js';
import { closeRealContracts, readRealHistory, readRealPortfolio } from '../../../trading/execute.js';


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

export async function closePortfolioContract({ account, contractId, token, appId, fetchImpl = fetch }) {
  if (!canTradeAccount(account, process.env)) return { status: 403, body: { error: 'Trading is disabled for this account.' } };
  if (!/^[1-9][0-9]*$/.test(contractId || '') || !Number.isSafeInteger(Number(contractId)))
    return { status: 400, body: { error: 'Invalid contract.' } };

  try {
    const broker = { account, token, appId, fetchImpl };
    const portfolio = await readRealPortfolio(broker);
    const contract = portfolio.contracts.find(row => row.id === contractId);
    if (!contract) return { status: 409, body: { error: 'This trade is no longer open. Check Analytics.' } };
    if (!contract.canSell) return { status: 409, body: { error: 'Deriv currently requires this trade to settle at expiry.' } };
    const [result] = await closeRealContracts({ ...broker, contractIds: [contractId] });
    if (!result?.closed) return { status: 409, body: { error: 'Deriv did not confirm the close. Check open trades before retrying.' } };
    return { status: 200, body: result };
  } catch {
    return { status: 502, body: { error: 'Close status unavailable. Refresh open trades before retrying.' } };
  }
}
