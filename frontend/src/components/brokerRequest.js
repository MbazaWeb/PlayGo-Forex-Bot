let cooldownUntil = 0;
let cooldownMs = 30_000;
const inFlight = new Map();

export function brokerCoolingDown() {
  return Date.now() < cooldownUntil;
}

export function pauseBrokerRequests(delay = 0) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.max(cooldownMs, delay));
  cooldownMs = Math.min(cooldownMs * 2, 120_000);
}

export async function brokerRequest(url, options = {}) {
  if (brokerCoolingDown() && !url.startsWith('/api/agent/stop?')) return new Response(null, { status: 429 });
  const read = !options.method || options.method === 'GET';
  if (read && inFlight.has(url)) return (await inFlight.get(url)).clone();
  const request = fetch(url, read ? { cache: 'no-store', signal: AbortSignal.timeout(20_000) } : options)
    .then(response => {
      if (response.status === 429) {
        const retry = response.headers.get('Retry-After');
        const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
        pauseBrokerRequests(delay || 0);
      } else if (response.ok && !brokerCoolingDown()) {
        cooldownMs = 30_000;
      }
      return response;
    });
  if (!read) return request;
  inFlight.set(url, request);
  try { return (await request).clone(); }
  finally { inFlight.delete(url); }
}

export function simpleBotStatus(raw) {
  const message = String(raw || '');
  if (/429|RATE[ _]LIMIT|rate limit/i.test(message)) return 'Deriv is busy. PlayGo will wait before checking again.';
  if (/PROPOSAL[ _]REJECTED|ContractBuyValidationError/i.test(message)) return 'Deriv declined the trade quote. No order was placed.';
  if (/WEAK[ _]SIGNAL/i.test(message)) return 'Waiting for a stronger signal.';
  if (/OPEN[ _]EXPOSURE[ _]LIMIT/i.test(message)) return 'Open trades are using the available risk budget.';
  if (/OPEN_CONTRACT_LIMIT/i.test(message)) return 'Open position limit reached.';
  if (/MARKET_ALREADY_OPEN/i.test(message)) return 'A position is already open on this market.';
  if (/EARLY_SALE_UNAVAILABLE/i.test(message)) return 'Deriv is not offering an early sale for this position.';
  if (/ORDER[ _]OUTCOME[ _]UNKNOWN|UNKNOWN[ _]ORDER[ _]STATE/i.test(message)) return 'Order outcome is unclear. Check Trades before trying again.';
  if (/Deriv confirmed (?:the in-flight order|an order) for/i.test(message)) return (message.match(/order for ([^.]+)/i)?.[1] || 'Market') + ' trade opened.';
  if (/DERIV_|HTTP [45]\d\d|Agent could not complete its run:/i.test(message)) return 'The bot could not complete this check. See Trades for confirmed orders.';
  return message;
}
