import { readTradeEvidence } from '../../../trading/real-store.js';
import { isDerivAccount, canTradeAccount } from '../../../trading/deriv-account.js';
import { closeRealContracts, readRealHistory, readRealPortfolio, readSettlementRange } from '../../../trading/execute.js';


export async function readPortfolio({ account, token, appId, fetchImpl = fetch }) {
  if (!isDerivAccount(account)) return { status: 403, body: { error: 'REAL_ACCOUNT_REQUIRED' } };
  const body = await readRealPortfolio({ account, token, appId, fetchImpl });
  return { status: 200, body };
}

export async function readHistory({ account, token, appId, range = null, includeEvidence = false, fetchImpl = fetch }) {
  if (!isDerivAccount(account)) return { status: 403, body: { error: 'REAL_ACCOUNT_REQUIRED' } };
  let body;
  if (range !== null) {
    if (range.mode !== '1' || !/^\d{1,11}$/.test(range.from || '') || !/^\d{1,11}$/.test(range.to || '')) {
      return { status: 400, body: { error: 'Select a valid settlement date range.' } };
    }
    const from = Number(range.from), to = Number(range.to);
    if (from <= 0 || to < from || to > Math.floor(Date.now() / 1000)) {
      return { status: 400, body: { error: 'Select a valid settlement date range.' } };
    }
    const result = await readSettlementRange({ account, token, appId, fetchImpl, from, to, maxRows: 10_000 });
    body = { ...result, accountId: account.account_id, from, to };
  } else {
    body = await readRealHistory({ account, token, appId, fetchImpl });
  }
  if (includeEvidence) {
    try {
      body.evidence = await readTradeEvidence({ accountId: account.account_id, contractIds: body.transactions.map(row => row.contractId), fetchImpl });
    } catch {
      body.evidence = null;
    }
  }
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
