const DURATION_UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

function flag(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}

function symbolOf(row) {
  const symbol = row?.underlying_symbol ?? row?.symbol;
  return typeof symbol === 'string' && symbol ? symbol : null;
}

function marketStatus(row) {
  const suspended = flag(row?.is_trading_suspended);
  const exchangeOpen = flag(row?.exchange_is_open);
  const tradingAllowed = row?.is_trading_allowed == null
    ? true
    : flag(row.is_trading_allowed);
  if (suspended === true) return 'Suspended';
  if (exchangeOpen === false || tradingAllowed === false) return 'Closed';
  if (exchangeOpen === true && suspended === false && tradingAllowed === true) return 'Open';
  return 'Unknown';
}

function durationSeconds(value) {
  const match = typeof value === 'string' && /^([1-9]\d*)([smhd])$/.exec(value);
  return match ? Number(match[1]) * DURATION_UNITS[match[2]] : NaN;
}

function supportsDuration(row, type, seconds) {
  if (row?.contract_type !== type || row.expiry_type === 'tick' ||
      (row.barriers != null && Number(row.barriers) !== 0)) return false;
  const minimum = durationSeconds(row.min_contract_duration);
  const maximum = durationSeconds(row.max_contract_duration);
  return Number.isFinite(minimum) && Number.isFinite(maximum) &&
    seconds >= minimum && seconds <= maximum;
}

export function normalizeActiveSymbol(row) {
  const symbol = symbolOf(row);
  if (!symbol) return null;
  const market = typeof row.market === 'string' ? row.market : 'Other';
  const name = row.underlying_symbol_name || row.display_name;
  return {
    symbol,
    status: marketStatus(row),
    name: typeof name === 'string' && name ? name : symbol,
    group: market.replaceAll('_', ' '),
  };
}

export function isMarketOpen(response, symbol) {
  return (Array.isArray(response?.active_symbols) ? response.active_symbols : [])
    .some(row => symbolOf(row) === symbol && marketStatus(row) === 'Open');
}

export function supportsContractDuration(response, contractType, duration, durationUnit) {
  const rows = response?.contracts_for?.available;
  const secondsPerUnit = DURATION_UNITS[durationUnit];
  if (!Array.isArray(rows) || !['CALL', 'PUT'].includes(contractType) ||
      !Number.isSafeInteger(duration) || duration <= 0 || !secondsPerUnit) return false;
  return rows.some(row => supportsDuration(row, contractType, duration * secondsPerUnit));
}

export function supportedTradeDurations(response, candidates) {
  const rows = response?.contracts_for?.available;
  if (!Array.isArray(rows)) throw Error('Contract durations unavailable.');
  return Object.fromEntries(['CALL', 'PUT'].map(type => [
    type,
    candidates.filter(minutes => rows.some(row => supportsDuration(row, type, minutes * 60))),
  ]));
}
