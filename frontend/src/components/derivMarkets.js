export function publicRequest(payload, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Cancelled'));
    const socket = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    function finish(value, error) {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      socket.onclose = socket.onerror = socket.onmessage = socket.onopen = null;
      socket.close();
      if (error) reject(error);
      else resolve(value);
    }
    const cancel = () => finish(null, new Error('Cancelled'));
    const unavailable = () => finish(null, new Error('Deriv market data unavailable'));
    const timer = setTimeout(unavailable, 12000);
    signal.addEventListener('abort', cancel, {once:true});
    socket.onerror = socket.onclose = unavailable;
    socket.onopen = () => socket.send(JSON.stringify({...payload, req_id:1}));
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.req_id !== 1) return;
        if (message.error) unavailable();
        else finish(message);
      } catch { unavailable(); }
    };
  });
}

export function readMarkets(response) {
  const unique = new Map();
  for (const row of response.active_symbols ?? []) {
    if (typeof row.underlying_symbol !== 'string' || !row.underlying_symbol) continue;
    unique.set(row.underlying_symbol, {
      symbol: row.underlying_symbol, name: row.underlying_symbol_name || row.underlying_symbol,
      group: (row.market || 'Other').replaceAll('_', ' ')
    });
  }
  return [...unique.values()].sort((a,b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

export function readCandles(response) {
  return (response.candles ?? []).flatMap(row => {
    const fields = ['epoch','open','high','low','close'];
    if (!fields.every(k => row[k] != null && row[k] !== '' && Number.isFinite(Number(row[k])))) return [];
    const [epoch,open,high,low,close] = fields.map(k => Number(row[k]));
    if (epoch <= 0 || high < Math.max(open,close) || low > Math.min(open,close)) return [];
    const time = new Date(epoch*1000).toISOString().slice(5,16).replace('T',' ');
    return [{epoch, time, open, high, low, close, value:close}];
  }).sort((a,b) => a.epoch-b.epoch);
}
