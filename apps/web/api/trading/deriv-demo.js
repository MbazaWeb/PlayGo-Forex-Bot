// Deriv Options API demo-only transport. Never pass a real-account URL.
// IMPORTANT: This adapter does not by itself provide durable idempotency or reconciliation.
const API = 'https://api.derivws.com';
export async function getDemoWebSocketUrl({ token, accountId, appId, fetchImpl = fetch }) {
  if (!token || !/^[a-zA-Z0-9_-]{3,80}$/.test(accountId || '')) throw Error('INVALID_AUTH_CONTEXT');
  const response = await fetchImpl(API + '/trading/v1/options/accounts/' + encodeURIComponent(accountId) + '/otp', {
    method: 'POST', redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, ...(appId ? { 'Deriv-App-ID': String(appId) } : {}) },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error('DERIV_OTP_FAILED');
  const body = await response.json();
  const url = body?.data?.url;
  const parsed = new URL(url);
  if (parsed.protocol !== 'wss:' || parsed.host !== 'api.derivws.com' || parsed.username || parsed.password || parsed.hash ||
      parsed.pathname !== '/trading/v1/options/ws/demo' || !parsed.searchParams.get('otp'))
    throw Error('NOT_A_DEMO_ENDPOINT');
  return url;
}
export function demoProposal(intent, currency) {
  return { proposal: 1, amount: intent.stake, basis: 'stake',
    contract_type: intent.contractType, currency,
    duration: intent.duration, duration_unit: intent.durationUnit,
    underlying_symbol: intent.symbol };
}
export function validateDemoPurchaseGate({ decision, persistedReservation, confirmedDemoAccount, proposal }) {
  if (!decision?.allowed || persistedReservation?.state !== 'reserved' ||
      persistedReservation?.unique !== true || confirmedDemoAccount !== true ||
      !proposal?.id || !Number.isFinite(Number(proposal.ask_price)))
    throw Error('EXECUTION_NOT_AUTHORIZED');
  return { buy: proposal.id, price: Number(proposal.ask_price) };
}
