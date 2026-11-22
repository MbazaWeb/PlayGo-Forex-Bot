// paperMarkets.js
//
// REAL DERIV MARKETS — DEMO EXECUTION ONLY.
//
// This file is the source of static watchlist metadata. It never contains
// live prices, account balances, or bot performance.
//
// DESIGN RULES (do not violate):
//   • Every `symbol` MUST be a real Deriv underlying symbol accepted by
//     `ticks_history` and by the backend demo execution routes.
//   • `price` and `change` are NOT live. They are `null`. The UI MUST fetch
//     live candles via `publicRequest` (see `derivMarkets.js`) and MUST NOT
//     display any price that did not come from that feed.
//   • Prices are sourced only from the public Deriv market feed.
//   • Bot state and performance are sourced only from the demo API.
//
// Anything that presents a fabricated number as if it were real is a bug.

// -----------------------------------------------------------------------------
// Watchlist catalog
// -----------------------------------------------------------------------------
// `group` mirrors the Deriv `market` field (with underscores → spaces) so the
// watchlist and `InstrumentSelect` can group consistently.
// `live: false` is a permanent marker: this file never produces live data.

export const markets = [
  // --- Continuous Indices -----------------------------------------------------
  {
    symbol: 'R_10',
    name: 'Volatility 10 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'R_25',
    name: 'Volatility 25 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'R_50',
    name: 'Volatility 50 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'R_75',
    name: 'Volatility 75 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'R_100',
    name: 'Volatility 100 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'BOOM500',
    name: 'Boom 500 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'BOOM1000',
    name: 'Boom 1000 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'CRASH500',
    name: 'Crash 500 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'CRASH1000',
    name: 'Crash 1000 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'stpRNG',
    name: 'Step Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'JD10',
    name: 'Jump 10 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'JD25',
    name: 'Jump 25 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'JD50',
    name: 'Jump 50 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'JD75',
    name: 'Jump 75 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'JD100',
    name: 'Jump 100 Index',
    group: 'Continuous Indices',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },

  // --- Forex ------------------------------------------------------------------
  {
    symbol: 'frxEURUSD',
    name: 'EUR/USD',
    group: 'Forex',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxGBPUSD',
    name: 'GBP/USD',
    group: 'Forex',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxUSDJPY',
    name: 'USD/JPY',
    group: 'Forex',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxAUDUSD',
    name: 'AUD/USD',
    group: 'Forex',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxUSDCAD',
    name: 'USD/CAD',
    group: 'Forex',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxUSDCHF',
    name: 'USD/CHF',
    group: 'Forex',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxEURGBP',
    name: 'EUR/GBP',
    group: 'Forex',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxEURJPY',
    name: 'EUR/JPY',
    group: 'Forex',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },

  // --- Metals -----------------------------------------------------------------
  {
    symbol: 'frxXAUUSD',
    name: 'Gold/USD',
    group: 'Metals',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxXAGUSD',
    name: 'Silver/USD',
    group: 'Metals',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },

  // --- Commodities ------------------------------------------------------------
  {
    symbol: 'frxBROUSD',
    name: 'Brent Crude Oil/USD',
    group: 'Commodities',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'frxXPTUSD',
    name: 'Platinum/USD',
    group: 'Commodities',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },

  // --- Crypto -----------------------------------------------------------------
  {
    symbol: 'cryBTCUSD',
    name: 'BTC/USD',
    group: 'Cryptocurrencies',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
  {
    symbol: 'cryETHUSD',
    name: 'ETH/USD',
    group: 'Cryptocurrencies',
    price: null,
    change: null,
    live: false,
    execution: 'demo',
  },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Look up a market by Deriv symbol. Returns `undefined` if not in catalog. */
export function findMarket(symbol) {
  return markets.find((m) => m.symbol === symbol);
}

/** Group markets by their `group` field. Returns a Map<string, Market[]>. */
export function groupMarkets(rows = markets) {
  const out = new Map();
  for (const m of rows) {
    if (!out.has(m.group)) out.set(m.group, []);
    out.get(m.group).push(m);
  }
  return out;
}

/** Every symbol in the catalog. Useful for validating user input. */
export const MARKET_SYMBOLS = Object.freeze(markets.map((m) => m.symbol));