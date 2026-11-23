const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const CONNECT_TIMEOUT_MS = 15000;

export function publicRequest(payload, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));

    let socket;
    let settled = false;

    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);

      if (socket?.readyState === WebSocket.OPEN) {
        socket.close();
      } else if (socket?.readyState === WebSocket.CONNECTING) {
        socket.onopen = () => socket.close();
      }

      if (error) reject(error);
      else resolve(value);
    };

    const onAbort = () => finish(null, new Error('Cancelled'));
    signal?.addEventListener?.('abort', onAbort, { once: true });

    const timer = setTimeout(() => finish(null, new Error('Deriv market data timeout')), CONNECT_TIMEOUT_MS);

    try {
      socket = new WebSocket(WS_URL);
    } catch (err) {
      return finish(null, new Error('Could not create WebSocket'));
    }

    socket.onopen = () => {
      if (settled) return;
      try { socket.send(JSON.stringify({ ...payload, req_id: 1 })); } catch (err) { finish(null, err); }
    };

    socket.onmessage = (event) => {
      if (settled) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.req_id !== 1) return;

      if (message.error) {
        finish(null, new Error(message.error.message || 'Deriv market data unavailable'));
      } else {
        finish(message);
      }
    };

    socket.onerror = () => {
      if (settled) return;
      // Usifanye kosa kama socket ilikuwa imefungwa na wewe mwenyewe
      if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
      finish(null, new Error('Deriv WebSocket error'));
    };

    socket.onclose = (event) => {
      if (settled) return;
      finish(null, new Error('Deriv WebSocket closed: ' + event.code));
    };
  });
}

export function readMarkets(response) {
  const unique = new Map();
  const symbols = response?.active_symbols;
  for (const row of Array.isArray(symbols) ? symbols : []) {
    if (typeof row?.underlying_symbol !== 'string' || !row.underlying_symbol) continue;
    unique.set(row.underlying_symbol, {
      status: row.is_trading_suspended === 1 ? 'Suspended'
        : row.exchange_is_open === 0 ? 'Closed'
          : row.exchange_is_open === 1 && row.is_trading_suspended === 0 ? 'Open' : 'Unknown',
      symbol: row.underlying_symbol,
      name: row.underlying_symbol_name || row.underlying_symbol,
      group: (row.market || 'Other').replaceAll('_', ' '),
    });
  }
  return [...unique.values()].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

const MIN_EPOCH = 1_000_000_000;
const MAX_EPOCH = 10_000_000_000;

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
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
    if (unique.has(epoch)) continue;
    const time = new Date(epoch * 1000).toISOString().slice(5, 16).replace('T', ' ');
    unique.set(epoch, { epoch, time, open, high, low, close, value: close });
  }
  return [...unique.values()].sort((a, b) => a.epoch - b.epoch);
}
const durationUnits = { s: 1, m: 60, h: 3600, d: 86400 };

function durationSeconds(value) {
  const match = typeof value === 'string' && /^(\d+)([smhd])$/.exec(value);
  return match ? Number(match[1]) * durationUnits[match[2]] : NaN;
}

export function supportedTradeDurations(response, candidates) {
  const rows = response?.contracts_for?.available;
  if (!Array.isArray(rows)) throw Error('Contract durations unavailable.');
  return Object.fromEntries(['CALL', 'PUT'].map(type => [
    type,
    candidates.filter(minutes => rows.some(row => {
      if (row?.contract_type !== type || row.expiry_type === 'tick' ||
          (row.barriers != null && row.barriers !== 0)) return false;
      const seconds = minutes * 60;
      return seconds >= durationSeconds(row.min_contract_duration) &&
        seconds <= durationSeconds(row.max_contract_duration);
    })),
  ]));
}
