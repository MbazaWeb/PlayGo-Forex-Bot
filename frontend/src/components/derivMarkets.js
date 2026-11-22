const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const CONNECT_TIMEOUT_MS = 12000;
const MAX_READ_ATTEMPTS = 3;

function openSocket(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    let settled = false;
    const socket = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error('Deriv market data unavailable'));
    }, CONNECT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      socket.onopen = socket.onerror = socket.onclose = socket.onmessage = null;
      signal?.removeEventListener?.('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error('Cancelled'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();

    socket.onerror = socket.onclose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Deriv market data unavailable'));
    };
    socket.onopen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    };
  });
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      reject(new Error('Cancelled'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function retryRead(operation, signal, wait = waitForRetry) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted || error?.message === 'Cancelled' || attempt >= MAX_READ_ATTEMPTS - 1) {
        throw error;
      }
      await wait(500 * (2 ** attempt), signal);
    }
  }
}

/**
 * Send a single request over the public WebSocket and resolve with the
 * first response whose req_id matches. Rejects on error frames, socket
 * close, timeout, or abort.
 */
export async function publicRequest(payload, signal) {
  return retryRead(() => requestOnce(payload, signal), signal);
}

async function requestOnce(payload, signal) {
  const socket = await openSocket(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const reqId = 1;

    function finish(value, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(); } catch { /* ignore */ }
      signal?.removeEventListener?.('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    }

    const timer = setTimeout(
      () => finish(null, new Error('Deriv market data unavailable')),
      CONNECT_TIMEOUT_MS,
    );
    const onAbort = () => finish(null, new Error('Cancelled'));

    if (signal?.aborted) return finish(null, new Error('Cancelled'));
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) return finish(null, new Error('Cancelled'));

    socket.onerror = socket.onclose = () =>
      finish(null, new Error('Deriv market data unavailable'));

    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.req_id !== reqId) return;
      clearTimeout(timer);
      if (message.error) {
        finish(null, new Error(message.error.message || 'Deriv market data unavailable'));
      } else {
        finish(message);
      }
    };

    try {
      socket.send(JSON.stringify({ ...payload, req_id: reqId }));
    } catch {
      finish(null, new Error('Could not send request to Deriv'));
    }
  });
}

export function readMarkets(response) {
  const unique = new Map();
  for (const row of response?.active_symbols ?? []) {
    if (typeof row?.underlying_symbol !== 'string' || !row.underlying_symbol) continue;
    unique.set(row.underlying_symbol, {
      symbol: row.underlying_symbol,
      name: row.underlying_symbol_name || row.underlying_symbol,
      group: (row.market || 'Other').replaceAll('_', ' '),
    });
  }
  return [...unique.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
  );
}

const MIN_EPOCH = 1_000_000_000; // 2001
const MAX_EPOCH = 10_000_000_000; // year ~2286, well beyond any plausible response

export function readCandles(response) {
  const unique = new Map();
  for (const row of response?.candles ?? []) {
    if (!row || typeof row !== 'object') continue;
    const fields = ['epoch', 'open', 'high', 'low', 'close'];
    if (!fields.every((k) => row[k] != null && row[k] !== '')) continue;
    const nums = fields.map((k) => Number(row[k]));
    if (!nums.every(Number.isFinite)) continue;
    const [epoch, open, high, low, close] = nums;
    if (epoch < MIN_EPOCH || epoch > MAX_EPOCH) continue;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
    if (high < Math.max(open, close) || low > Math.min(open, close)) continue;
    if (high < low) continue;
    if (unique.has(epoch)) continue; // keep first occurrence for duplicates
    const time = new Date(epoch * 1000).toISOString().slice(5, 16).replace('T', ' ');
    unique.set(epoch, { epoch, time, open, high, low, close, value: close });
  }
  return [...unique.values()].sort((a, b) => a.epoch - b.epoch);
}