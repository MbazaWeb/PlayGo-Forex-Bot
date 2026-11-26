import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMarketOpen,
  normalizeActiveSymbol,
  supportedTradeDurations,
  supportsContractDuration,
} from './deriv-market.js';

test('active market parsing accepts Deriv symbol and underlying_symbol response shapes', () => {
  const legacy = {
    symbol: 'R_75',
    display_name: 'Volatility 75 Index',
    market: 'synthetic_index',
    exchange_is_open: 1,
    is_trading_suspended: 0,
  };
  const options = {
    underlying_symbol: 'frxEURUSD',
    underlying_symbol_name: 'EUR/USD',
    market: 'forex',
    exchange_is_open: '1',
    is_trading_suspended: '0',
    is_trading_allowed: 1,
  };

  assert.deepEqual(normalizeActiveSymbol(legacy), {
    symbol: 'R_75',
    status: 'Open',
    name: 'Volatility 75 Index',
    group: 'synthetic index',
  });
  assert.equal(normalizeActiveSymbol(options).symbol, 'frxEURUSD');
  assert.equal(isMarketOpen({ active_symbols: [legacy] }, 'R_75'), true);
  assert.equal(isMarketOpen({ active_symbols: [{ ...legacy, is_trading_suspended: 1 }] }, 'R_75'), false);
  assert.equal(isMarketOpen({ active_symbols: [{ ...legacy, is_trading_allowed: 0 }] }, 'R_75'), false);
});

test('contract availability checks CALL/PUT and exact requested duration limits', () => {
  const response = {
    contracts_for: {
      available: [
        { contract_type: 'CALL', expiry_type: 'duration', min_contract_duration: '1m', max_contract_duration: '15m', barriers: '0' },
        { contract_type: 'PUT', expiry_type: 'duration', min_contract_duration: '5m', max_contract_duration: '60m' },
        { contract_type: 'CALL', expiry_type: 'tick', min_contract_duration: '1t', max_contract_duration: '10t' },
      ],
    },
  };
  assert.equal(supportsContractDuration(response, 'CALL', 1, 'm'), true);
  assert.equal(supportsContractDuration(response, 'PUT', 1, 'm'), false);
  assert.equal(supportsContractDuration(response, 'PUT', 5, 'm'), true);
  assert.equal(supportsContractDuration(response, 'CALL', 60, 'm'), false);
  assert.deepEqual(supportedTradeDurations(response, [1, 5, 15, 60]), {
    CALL: [1, 5, 15],
    PUT: [5, 15, 60],
  });
});
