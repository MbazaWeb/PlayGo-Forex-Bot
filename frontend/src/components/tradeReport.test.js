import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadTradePdf, downloadTradeReport } from './tradeReport.js';

const settlementFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Dar_es_Salaam',
  dateStyle: 'medium',
  timeStyle: 'medium',
});

async function captureReport(generate) {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalSetTimeout = globalThis.setTimeout;
  let blob;
  globalThis.document = {
    createElement: () => ({ click() {}, remove() {} }),
    body: { append() {} },
  };
  URL.createObjectURL = value => {
    blob = value;
    return 'blob:trade-report';
  };
  URL.revokeObjectURL = () => {};
  globalThis.setTimeout = () => 0;
  try {
    generate();
    return await blob.text();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    globalThis.setTimeout = originalSetTimeout;
  }
}

const sample = {
  id: 'CR123456',
  currency: 'USD',
  points: [{
    time: 'transaction-1',
    contractId: '12345',
    settledAt: 1_760_000_000,
    status: 'Win',
    buy: 10,
    sell: 12,
    value: 2,
  }],
  performance: {
    net: 2, average: 2, averageWin: 2, averageLoss: null,
    profitFactor: null, drawdown: 0,
  },
  wins: 1,
  losses: 0,
  even: 0,
  settlementFormat,
  evidence: {
    '12345': {
      strategy: 'Trend + momentum',
      score: 86,
      symbol: 'R_100',
      direction: 'CALL',
      duration: 5,
      execution: {
        intentId: 'intent-1', status: 'confirmed', stake: 10, transactionId: '67890',
        settlementTransactionId: '98765', buy: 10, sell: 12, outcome: 'won',
      },
      exitSettings: { stopLossPercent: 20, takeProfitPercent: 30 },
      technical: {
        candleEpoch: 1_760_000_000, close: 100.25, sma20: 99.5, sma50: 98.75,
        rsi: 55, momentumPct: 0.4, volatilityPct: 0.25, volatilityRank: 0.5,
        bullishScore: 80, bearishScore: 20, direction: 'CALL', block: null,
      },
      lifecycle: [{ event: 'ORDER_CONFIRM', data: {}, recordedAt: '2025-10-09T10:00:00.000Z' }],
      exit: { outcome: 'CLOSED', profit: 2, canSell: true, soldFor: 12, checkedAt: '2025-10-09T10:05:00.000Z' },
      close: {
        status: 'unconfirmed', outcome: 'unconfirmed', reason: 'CLOSE_UNCONFIRMED',
        transactionId: '54321', requestedAt: '2025-10-09T10:05:00.000Z', confirmedAt: null,
      },
    },
  },
  failures: [{
    source: 'application',
    recordedAt: '2025-10-09T10:01:00.000Z',
    status: 'watching',
    reason: 'MARKET_DATA_GAP',
    symbol: 'R_100',
    granularity: 300,
    mode: 'automatic',
    stage: 'Market data',
    observedAt: '2025-10-09T10:01:00.000Z',
    nextAction: 'Wait for at least 50 consecutive closed candles; inspect the feed if the gap persists.',
  }, {
    source: 'browser-console',
    event: 'BROWSER_CONSOLE',
    recordedAt: '2025-10-09T10:02:00.000Z',
    status: 'error',
    path: '/analytics',
    requestId: 'request-1',
    message: 'Fetch failed: code=E_NETWORK',
  }],
  failuresComplete: true,
  serverLogs: {
    status: 'complete',
    complete: true,
    coverageFrom: '2025-10-09T09:00:00.000Z',
    coverageTo: '2025-10-09T10:00:00.000Z',
    note: 'Correlated Vercel logs loaded.',
    logs: [{
      recordedAt: '2025-10-09T10:03:00.000Z',
      level: 'error',
      method: 'GET',
      path: '/api/history',
      statusCode: 500,
      requestId: 'request-1',
      deploymentId: 'dpl_12345678',
      message: 'code=E_REPORT_FAILED',
    }],
  },
};

test('PDF includes trade technicals, lifecycle, close evidence, and failure diagnostics', async () => {
  const pdf = await captureReport(() => downloadTradePdf(sample));
  assert.match(pdf, /Trend \+ momentum/);
  assert.match(pdf, /SMA20 99\.5000/);
  assert.match(pdf, /ORDER_CONFIRM/);
  assert.match(pdf, /MARKET_DATA_GAP/);
  assert.match(pdf, /Stage: Market data/);
  assert.match(pdf, /Wait for at least 50 consecutive closed candles/);
  assert.match(pdf, /early sale allowed/);
  assert.match(pdf, /Broker IDs: buy 67890/);
  assert.match(pdf, /settlement 98765/);
  assert.match(pdf, /broker transaction: 54321/);
  assert.match(pdf, /Close result: unconfirmed/);
  assert.match(pdf, /Browser console diagnostics/);
  assert.match(pdf, /Fetch failed: code=E_NETWORK/);
  assert.match(pdf, /Vercel runtime diagnostics/);
  assert.match(pdf, /dpl_12345678/);
});

test('Excel workbook contains detailed trade and technical-failure sheets', async () => {
  const workbook = await captureReport(() => downloadTradeReport(sample));
  assert.match(workbook, /Technical failures/);
  assert.match(workbook, /Trend \+ momentum/);
  assert.match(workbook, /MARKET_DATA_GAP/);
  assert.match(workbook, /Wait for at least 50 consecutive closed candles/);
  assert.match(workbook, /Observed at/);
  assert.match(workbook, /Entry candle epoch/);
  assert.match(workbook, /Broker buy transaction ID/);
  assert.match(workbook, /Close reason/);
  assert.match(workbook, /Settlement transaction ID/);
  assert.match(workbook, /Browser console/);
  assert.match(workbook, /Fetch failed: code=E_NETWORK/);
  assert.match(workbook, /Vercel runtime logs/);
  assert.match(workbook, /dpl_12345678/);
});
