const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const GRANULARITIES = new Set([60, 300, 900, 3600]);

export async function readMarketCandles({ symbol, granularity, Socket = globalThis.WebSocket, now = Date.now }) {
  if (!/^[A-Za-z0-9_]{2,30}$/.test(symbol || '') || !GRANULARITIES.has(granularity))
    throw Error('INVALID_MARKET_REQUEST');
  if (typeof Socket !== 'function') throw Error('WEBSOCKET_UNAVAILABLE');

  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    const timer = setTimeout(() => finish(Error('MARKET_DATA_TIMEOUT')), 10000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket?.readyState === 1 || socket?.readyState === 0) socket.close();
      if (error) reject(error);
      else resolve(value);
    };

    try {
      socket = new Socket(WS_URL);
    } catch {
      finish(Error('WEBSOCKET_UNAVAILABLE'));
      return;
    }

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({
          ticks_history: symbol,
          style: 'candles',
          end: 'latest',
          count: 200,
          granularity,
          req_id: 1,
        }));
      } catch {
        finish(Error('MARKET_DATA_SEND_FAILED'));
      }
    };
    socket.onmessage = event => {
      let response;
      try {
        response = JSON.parse(String(event.data));
      } catch {
        finish(Error('INVALID_MARKET_RESPONSE'));
        return;
      }
      if (response.req_id !== 1) return;
      if (response.error || !Array.isArray(response.candles)) {
        finish(Error('MARKET_DATA_UNAVAILABLE'));
        return;
      }
      const currentEpoch = Math.floor(now() / 1000);
      const candles = response.candles.map(row => ({
        epoch: Number(row.epoch),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      })).filter(row =>
        Number.isSafeInteger(row.epoch) &&
        row.epoch + granularity <= currentEpoch &&
        [row.open, row.high, row.low, row.close].every(value => Number.isFinite(value) && value > 0) &&
        row.high >= Math.max(row.open, row.close) &&
        row.low <= Math.min(row.open, row.close) &&
        row.high >= row.low,
      );
      finish(null, candles);
    };
    socket.onerror = () => finish(Error('MARKET_DATA_DISCONNECTED'));
    socket.onclose = () => {
      if (!settled) finish(Error('MARKET_DATA_DISCONNECTED'));
    };
  });
}

export function marketIntegrityBlock(candles, granularity, nowMs) {
  const recent = candles.slice(-50);
  if (recent.length < 50) return 'INSUFFICIENT';
  const latestClosedStart = Math.floor(nowMs / 1000 / granularity) * granularity - granularity;
  if (recent.at(-1).epoch < latestClosedStart - granularity) return 'STALE_MARKET_DATA';
  const seen = new Set();
  for (let index = 0; index < recent.length; index++) {
    const { epoch } = recent[index];
    if (epoch % granularity !== 0 || epoch > latestClosedStart) return 'UNALIGNED_MARKET_DATA';
    if (seen.has(epoch)) return 'DUPLICATE_MARKET_DATA';
    seen.add(epoch);
  }
  if (recent.some((row, index) => index && row.epoch - recent[index - 1].epoch !== granularity))
    return 'MARKET_DATA_GAP';
  return null;
}
