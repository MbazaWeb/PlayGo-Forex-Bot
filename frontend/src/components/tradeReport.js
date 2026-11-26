import { evaluateLiveGate } from '../../../shared/live-gate.js';

const xml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]);

function sheet(name, rows) {
  const content = rows.map(row => '<Row>' + row.map(value =>
    '<Cell><Data ss:Type="' + (typeof value === 'number' && Number.isFinite(value) ? 'Number' : 'String') +
      '">' + xml(value) + '</Data></Cell>'
  ).join('') + '</Row>').join('');
  return '<Worksheet ss:Name="' + xml(name) + '"><Table>' + content + '</Table></Worksheet>';
}

export function downloadTradeReport({
  id, currency, points, performance, wins, losses, even, settlementFormat,
  evidence = null, failures = null, failuresComplete = false, serverLogs = null,
}) {
  const browserLogs = Array.isArray(failures)
    ? failures.filter(issue => issue.source === 'browser-console') : [];
  const technicalFailures = Array.isArray(failures)
    ? failures.filter(issue => issue.source !== 'browser-console') : [];
  const summary = [
    ['Metric', 'Value'], ['Account', id], ['Currency', currency],
    ['Scope', 'Deriv settlements in the selected report window, including bot and manual trades'],
    ['Settled trades', points.length], ['Wins', wins], ['Losses', losses], ['Break-even', even],
    ['Win rate (%)', points.length ? 100 * wins / points.length : 'Unavailable'], ['Net P&L', performance.net],
    ['Average P&L', performance.average], ['Profit factor', performance.profitFactor],
    ['Maximum drawdown', performance.drawdown], ['Average win', performance.averageWin],
    ['Average loss', performance.averageLoss],
    ['Technical failure records', Array.isArray(failures) ? failures.length : 'Unavailable'],
    ['Failure history complete', failuresComplete ? 'Yes' : 'No; unavailable or truncated'],
    ['Browser console entries', Array.isArray(failures) ? browserLogs.length : 'Unavailable'],
    ['Browser console capture note', Array.isArray(failures)
      ? 'Sanitized warnings/errors captured after diagnostics were enabled; may be incomplete'
      : 'Unavailable'],
    ['Vercel runtime logs', Array.isArray(serverLogs?.logs) ? serverLogs.logs.length : 'Unavailable'],
    ['Vercel log status', serverLogs?.status ?? 'Unavailable'],
    ['Vercel log coverage', serverLogs?.note ?? 'Unavailable'],
  ];
  const details = [
    ['Transaction', 'Contract', 'Settled (EAT)', 'Outcome', 'Buy price', 'Sell proceeds', 'P&L',
      'Market', 'Direction', 'Duration (min)', 'Strategy', 'Signal score', 'Intent ID', 'Intent status',
      'Recorded stake', 'Entry candle epoch', 'Entry close', 'SMA20', 'SMA50', 'RSI', 'Momentum %',
      'Volatility %', 'Volatility rank', 'Bullish score', 'Bearish score', 'Stop-loss %', 'Take-profit %',
      'Order lifecycle', 'Broker buy transaction ID', 'Settlement transaction ID', 'Close transaction ID',
      'Broker buy price', 'Broker sell price',
      'Settlement outcome', 'Exit outcome', 'Exit P&L at check', 'Early sale available', 'Confirmed proceeds',
      'Close status', 'Close outcome', 'Close reason', 'Close proceeds', 'Close requested at', 'Close confirmed at',
      'Loss review'],
    ...points.slice().sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0)).map(trade => {
      const validTime = Number.isSafeInteger(trade.settledAt) && trade.settledAt > 0 && trade.settledAt < 1e11;
      const detail = evidence?.[trade.contractId];
      const technical = detail?.technical;
      const lifecycle = (detail?.lifecycle ?? []).map(event =>
        event.event + (event.data?.from && event.data?.to ? ':' + event.data.from + '->' + event.data.to : '')
      ).join('; ');
      const exit = detail?.exit;
      const close = detail?.close;
      return [trade.time, trade.contractId, validTime ? settlementFormat.format(trade.settledAt * 1000) : 'Unavailable',
        trade.status, trade.buy, trade.sell, trade.value,
        detail?.symbol ?? 'Unavailable', detail?.direction ?? 'Unavailable', detail?.duration ?? 'Unavailable',
        detail?.strategy ?? 'Unavailable', detail?.score ?? 'Unavailable',
        detail?.execution?.intentId ?? 'Unavailable', detail?.execution?.status ?? 'Unavailable',
        detail?.execution?.stake ?? 'Unavailable', technical?.candleEpoch ?? 'Unavailable',
        technical?.close ?? 'Unavailable', technical?.sma20 ?? 'Unavailable', technical?.sma50 ?? 'Unavailable',
        technical?.rsi ?? 'Unavailable', technical?.momentumPct ?? 'Unavailable',
        technical?.volatilityPct ?? 'Unavailable', technical?.volatilityRank ?? 'Unavailable',
        technical?.bullishScore ?? 'Unavailable', technical?.bearishScore ?? 'Unavailable',
        detail?.exitSettings?.stopLossPercent ?? 'Unavailable',
        detail?.exitSettings?.takeProfitPercent ?? 'Unavailable',
        lifecycle || 'Unavailable',
        detail?.execution?.transactionId ?? 'Unavailable',
        detail?.execution?.settlementTransactionId ?? 'Unavailable',
        close?.transactionId ?? 'Unavailable',
        detail?.execution?.buy ?? 'Unavailable',
        detail?.execution?.sell ?? 'Unavailable',
        detail?.execution?.outcome ?? 'Unavailable',
        exit?.outcome ?? 'Unavailable',
        exit?.profit ?? 'Unavailable', exit?.canSell ?? 'Unavailable',
        exit?.soldFor ?? 'Unavailable',
        close?.status ?? 'Unavailable', close?.outcome ?? 'Unavailable',
        close?.reason ?? 'Unavailable', close?.soldFor ?? 'Unavailable',
        close?.requestedAt ?? 'Unavailable', close?.confirmedAt ?? 'Unavailable',
        trade.value < 0
          ? close ? 'Sell proceeds were below buy price. Close status: ' + close.status + '; reason: ' + (close.reason || 'Unavailable')
            : 'Sell proceeds were below buy price. Exit cause is unavailable in settlement history.'
          : ''];
    }),
  ];
  const failureRows = [
    ['Recorded at', 'Source', 'Event', 'Status', 'Reason', 'Contract', 'Market', 'Direction', 'Duration (min)',
      'Stake', 'Proceeds', 'Outcome', 'Broker transaction ID', 'Close requested at', 'Close confirmed at',
      'Interval (seconds)', 'Mode', 'From state', 'To state'],
    ...technicalFailures.map(issue => [
      issue.recordedAt ?? 'Unavailable', issue.source ?? 'application', issue.event ?? 'Unavailable', issue.status ?? 'Unavailable',
      issue.reason ?? 'Unavailable', issue.contractId ?? 'Unavailable',
      issue.symbol ?? 'Unavailable', issue.direction ?? 'Unavailable',
      issue.duration ?? 'Unavailable', issue.stake ?? 'Unavailable', issue.soldFor ?? 'Unavailable',
      issue.outcome ?? 'Unavailable', issue.transactionId ?? 'Unavailable',
      issue.requestedAt ?? 'Unavailable', issue.confirmedAt ?? 'Unavailable',
      issue.granularity ?? 'Unavailable', issue.mode ?? 'Unavailable',
      issue.from ?? 'Unavailable', issue.to ?? 'Unavailable',
    ]),
  ];
  const browserRows = [
    ['Capture note', Array.isArray(failures)
      ? 'Sanitized warnings/errors captured after diagnostics were enabled; may be incomplete'
      : 'Browser console data unavailable'],
    ['Audit query complete', failuresComplete ? 'Yes' : 'No'],
    [],
    ['Recorded at', 'Level', 'Path', 'Request ID', 'Message'],
    ...browserLogs.map(issue => [
      issue.recordedAt ?? 'Unavailable', issue.status ?? 'unknown', issue.path ?? 'Unavailable',
      issue.requestId ?? 'Unavailable', issue.message ?? 'Unavailable',
    ]),
  ];
  const runtimeRows = [
    ['Status', serverLogs?.status ?? 'Unavailable'],
    ['Complete', serverLogs?.complete === true ? 'Yes' : 'No'],
    ['Coverage from', serverLogs?.coverageFrom ?? 'Unavailable'],
    ['Coverage to', serverLogs?.coverageTo ?? 'Unavailable'],
    ['Coverage note', serverLogs?.note ?? 'Unavailable'],
    [],
    ['Recorded at', 'Level', 'Method', 'Path', 'Status code', 'Request ID', 'Deployment ID', 'Message'],
    ...(Array.isArray(serverLogs?.logs) ? serverLogs.logs.map(log => [
      log.recordedAt ?? 'Unavailable', log.level ?? 'unknown', log.method ?? 'Unavailable',
      log.path ?? 'Unavailable', log.statusCode ?? 'Unavailable', log.requestId ?? 'Unavailable',
      log.deploymentId ?? 'Unavailable', log.message ?? 'Unavailable',
    ]) : []),
  ];
  const workbook = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    sheet('Summary', summary) + sheet('Closed trades', details) +
    sheet('Technical failures', failureRows) + sheet('Browser console', browserRows) +
    sheet('Vercel runtime logs', runtimeRows) + '</Workbook>';
  saveReport(workbook, 'application/xml', 'PlayGo-' + id + '-trade-report.xml');
}

function saveReport(data, type, filename) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pdfText = value => String(value).replace(/[^ -~]/g, ' ').replace(/[\\()]/g, '\\$&');

function wrapPdfLine(value, width = 92) {
  const text = String(value);
  if (!text) return [''];
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (word.length > width) {
      if (line) lines.push(line);
      line = '';
      for (let offset = 0; offset < word.length; offset += width)
        lines.push(word.slice(offset, offset + width));
    } else if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line += (line ? ' ' : '') + word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Wilson 95% score interval for a win rate; more honest than a point estimate on small samples.
function wilsonInterval(successes, total) {
  if (!total) return null;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const centre = (p + z * z / (2 * total)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function downloadTradePdf({
  id, currency, points, performance, wins, losses, even, settlementFormat, evidence,
  failures = null, failuresComplete = false, serverLogs = null, partial = false, requestedRange = null,
}) {
  const money = value => Number.isFinite(value) ? value.toFixed(2) + ' ' + currency : 'Unavailable';
  const pct = value => Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : 'Unavailable';
  const metric = (value, digits = 4) => Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable';
  const timestamp = value => {
    if (value == null || value === '') return 'Time unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Time unavailable' : settlementFormat.format(date) + ' EAT';
  };
  const fullLosses = points.filter(trade => trade.value < 0 && trade.sell === 0);
  const rows = points.slice().sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0));
  const gate = evaluateLiveGate(points.map(trade => ({
    settledAt: trade.settledAt,
    buy: trade.buy,
    sell: trade.sell,
    strategy: evidence?.[trade.contractId]?.strategy ?? null,
    reconciled: false,
  })));
  const interval = wilsonInterval(wins, points.length);
  const browserLogs = Array.isArray(failures)
    ? failures.filter(issue => issue.source === 'browser-console') : [];
  const issueRows = Array.isArray(failures)
    ? failures.filter(issue => issue.source !== 'browser-console') : [];
  const breakEven = gate.summary.breakEven;
  const windowText = gate.summary.trades
    ? 'Window: ' + settlementFormat.format(Math.min(...points.map(t => t.settledAt)) * 1000) + ' to ' +
      settlementFormat.format(Math.max(...points.map(t => t.settledAt)) * 1000) + ' (EAT), ' + gate.summary.weeks + ' week(s).'
    : 'Window: no settlements.';
  const pages = [[
    'PlayGo trade review',
    'Account ' + id + ' | ' + currency + ' | ' + new Date().toISOString().slice(0, 10),
    'Scope: ' + points.length + ' settled Deriv trades, including bot and manual.',
    ...(requestedRange ? ['Requested range: ' + requestedRange] : []),
    ...(partial ? ['PARTIAL REPORT: broker row cap reached. Narrow the requested dates.'] : []),
    '',
    'RESULTS',
    'Wins: ' + wins + ' | Losses: ' + losses + ' | Break-even: ' + even,
    'Win rate: ' + (points.length ? (wins / points.length * 100).toFixed(1) + '%' : 'Unavailable') +
      (interval ? ' (95% interval ' + pct(interval[0]) + ' to ' + pct(interval[1]) + ')' : ''),
    'Break-even win rate at these payouts: ' + pct(breakEven),
    windowText,
    'Settlement P&L (costs unverified): ' + money(performance.net) + ' | Average per trade: ' + money(performance.average),
    'Profit factor: ' + (performance.profitFactor?.toFixed(2) ?? 'Unavailable'),
    'Average win: ' + money(performance.averageWin) + ' | Average loss: ' + money(performance.averageLoss),
    'Maximum drawdown: ' + money(performance.drawdown),
    'Zero-proceeds losses: ' + fullLosses.length + ' | P&L: ' + money(fullLosses.reduce((sum, trade) => sum + trade.value, 0)),
    '',
    evidence ? 'Trade audit evidence includes recorded order, strategy and exit events.'
      : 'PlayGo audit data was unavailable at the time of export.',
    'Recorded technical failures: ' + (Array.isArray(failures) ? failures.length : 'Unavailable'),
    failuresComplete
      ? 'Failure history is complete for the requested report window. Older failures may predate diagnostic logging.'
      : 'Failure history may be unavailable or truncated; do not infer that no issue occurred.',
    'Browser console warnings/errors: ' + (Array.isArray(failures) ? browserLogs.length : 'Unavailable'),
    'Vercel runtime logs: ' + (Array.isArray(serverLogs?.logs) ? serverLogs.logs.length : 'Unavailable') +
      ' | status: ' + (serverLogs?.status || 'unavailable'),
    serverLogs?.note || 'Vercel runtime log coverage is unavailable.',
    '',
    'LIVE-READINESS GATE: ' + (gate.passed ? 'PASSED' : 'NOT PASSED'),
    'Live trading requires every check below. This report does not show an edge until all pass.',
  ]];
  pages.push([
    'Live-readiness gate',
    'Thresholds are fixed in code (shared/live-gate.js).',
    '',
    ...gate.checks.flatMap(check => {
      const shown = typeof check.actual === 'number' && check.id !== 'sample' && check.id !== 'weeks' && check.id !== 'strategy' && check.id !== 'reconciled'
        ? (check.id === 'breakEven' ? pct(check.actual) + ' vs break-even ' + pct(check.threshold)
          : check.id === 'sessions' ? pct(check.actual) : check.id === 'profitFactor' ? check.actual.toFixed(2)
          : money(check.actual))
        : String(check.actual ?? 'Unavailable');
      return [(check.passed ? 'PASS  ' : 'FAIL  ') + check.label, '      Actual: ' + shown];
    }),
    '',
    gate.passed ? 'All checks passed. Still review the full trade log before any real-money decision.'
      : 'Not ready for live trading. Keep the account on Demo until every check passes on a new, larger sample.',
  ]);
  for (let start = 0; start < rows.length; start += 2) {
    pages.push(['Closed trades | EAT', 'Buy price, proceeds and net P&L in ' + currency, '',
      ...rows.slice(start, start + 2).flatMap(trade => {
        const validTime = Number.isSafeInteger(trade.settledAt) && trade.settledAt > 0 && trade.settledAt < 1e11;
        const detail = evidence?.[trade.contractId];
        const exit = detail?.exit;
        const close = detail?.close;
        const technical = detail?.technical;
        const lifecycle = detail?.lifecycle ?? [];
        const lifecycleLines = lifecycle.map(event => {
          const transition = event.data?.from && event.data?.to
            ? ' (' + event.data.from + ' -> ' + event.data.to + ')'
            : '';
          return 'Order event: ' + event.event + transition +
            (event.recordedAt ? ' at ' + timestamp(event.recordedAt) : '');
        });
        return [
          (validTime ? settlementFormat.format(trade.settledAt * 1000) : 'Time unavailable') + ' | ' + trade.status,
          'Transaction ' + trade.time + ' | Contract ' + (trade.contractId || 'Unavailable'),
          'Buy ' + money(trade.buy) + ' | Proceeds ' + money(trade.sell) + ' | Net ' + money(trade.value),
          'Strategy: ' + (detail?.strategy || 'Unavailable') + (Number.isFinite(detail?.score) ? ' | Signal score: ' + detail.score + '/100' : ''),
          'Market: ' + (detail?.symbol || 'Unavailable') + ' | Direction: ' +
            ({ CALL: 'Rise', PUT: 'Fall' }[detail?.direction] || 'Unavailable') + (detail?.duration ? ' | ' + detail.duration + ' min' : ''),
          'Execution: ' + (detail?.execution?.status || 'Unavailable') +
            ' | Intent: ' + (detail?.execution?.intentId || 'Unavailable') +
            ' | Buy price: ' + money(detail?.execution?.buy) +
            ' | Recorded stake: ' + money(detail?.execution?.stake),
          'Broker IDs: buy ' + (detail?.execution?.transactionId || 'Unavailable') +
            ' | settlement ' + (detail?.execution?.settlementTransactionId || 'Unavailable'),
          'Exit settings: stop-loss ' + metric(detail?.exitSettings?.stopLossPercent, 2) +
            '% | take-profit ' + metric(detail?.exitSettings?.takeProfitPercent, 2) + '%',
          ...(technical ? [
            'Entry candle: close ' + metric(technical.close) + ' at ' +
              (Number.isSafeInteger(technical.candleEpoch) ? timestamp(technical.candleEpoch * 1000) : 'Time unavailable') +
              ' | signal: ' + (technical.direction || 'none') + ' | block: ' + (technical.block || 'none'),
            'Technicals: SMA20 ' + metric(technical.sma20) + ', SMA50 ' + metric(technical.sma50) +
              ', RSI ' + metric(technical.rsi, 2) + ', momentum ' + metric(technical.momentumPct, 3) + '%' +
              ', volatility ' + metric(technical.volatilityPct, 4) + '%' +
              ', volatility rank ' + metric(technical.volatilityRank, 3),
            'Bullish / bearish scores: ' + metric(technical.bullishScore, 0) + ' / ' + metric(technical.bearishScore, 0),
          ] : ['Entry technical snapshot: unavailable for this trade.']),
          ...lifecycleLines,
          ...(close ? [
            'Close result: ' + (close.status || 'Unavailable') +
              ' | outcome: ' + (close.outcome || 'Unavailable') +
              ' | broker transaction: ' + (close.transactionId || 'Unavailable') +
              ' | reason: ' + (close.reason || 'Unavailable') +
              ' | proceeds: ' + money(close.soldFor) +
              ' | requested: ' + timestamp(close.requestedAt) +
              ' | confirmed: ' + timestamp(close.confirmedAt),
          ] : []),
          ...(trade.value < 0 ? [trade.sell === 0 ? 'Loss: zero proceeds; the full stake was lost.' : 'Loss: sale proceeds were below the stake.'] : []),
          exit ? 'Exit audit: ' + exit.outcome +
            ' | P&L at check: ' + money(exit.profit) +
            ' | early sale allowed: ' + (exit.canSell === true ? 'yes' : exit.canSell === false ? 'no' : 'unknown') +
            (Number.isFinite(exit.soldFor) ? ' | confirmed proceeds: ' + money(exit.soldFor) : '') +
            ' | recorded: ' + (exit.checkedAt || 'Unavailable')
            : close ? 'Exit audit: broker close status is ' + (close.status || 'unavailable') + '.'
            : 'Exit audit: unavailable. Exact exit cause cannot be established.',
          '',
        ];
      }),
    ]);
  }
  for (let start = 0; start < issueRows.length; start += 6) {
    pages.push([
      'Technical issues and failures',
      'Application, broker, rejected/unknown order and market-data diagnostics recorded for the report window.',
      '',
      ...issueRows.slice(start, start + 6).flatMap(issue => [
        timestamp(issue.recordedAt) + ' | ' +
        (issue.source || 'application') + ' | ' +
          (issue.event || 'AGENT_FAILURE') + ' | ' +
          String(issue.status || 'unknown').toUpperCase() + ' | ' + (issue.reason || 'Reason unavailable'),
        'Contract: ' + (issue.contractId || 'Unavailable') +
          ' | outcome: ' + (issue.outcome || 'Unavailable') +
          ' | proceeds: ' + money(issue.soldFor) +
          ' | broker transaction: ' + (issue.transactionId || 'Unavailable') +
          ' | close requested: ' + timestamp(issue.requestedAt) +
          ' | close confirmed: ' + timestamp(issue.confirmedAt) +
          ' | Market: ' + (issue.symbol || 'Unavailable') +
          ' | direction: ' + (issue.direction || 'Unavailable') +
          ' | interval: ' + (Number.isFinite(issue.granularity) ? issue.granularity + ' seconds' : 'Unavailable') +
          ' | duration: ' + (Number.isFinite(issue.duration) ? issue.duration + ' min' : 'Unavailable') +
          ' | stake: ' + money(issue.stake) +
          ' | mode: ' + (issue.mode || 'Unavailable') +
          (issue.from || issue.to ? ' | state: ' + (issue.from || 'Unavailable') + ' -> ' + (issue.to || 'Unavailable') : ''),
      ]),
    ]);
  }
  if (!issueRows.length) {
    pages.push([
      'Technical issues and failures',
      failuresComplete
        ? 'No technical failure events were recorded in this window. Older failures may predate diagnostic logging.'
        : 'Failure records are unavailable or incomplete for this window.',
    ]);
  }
  for (let start = 0; start < browserLogs.length || start === 0; start += 4) {
    pages.push([
      'Browser console diagnostics',
      browserLogs.length + ' sanitized browser warnings/errors captured for this report window.',
      'Console messages are filtered and redacted before storage; entries may still be incomplete.',
      '',
      ...browserLogs.slice(start, start + 4).flatMap(issue => [
        timestamp(issue.recordedAt) + ' | ' + String(issue.status || 'unknown').toUpperCase() +
          ' | ' + (issue.path || 'Unavailable') + ' | request ' + (issue.requestId || 'Unavailable'),
        'Message: ' + (issue.message || 'Unavailable'),
      ]),
      ...(!browserLogs.length ? ['No browser console entries were recorded in this window.'] : []),
    ]);
  }
  const runtimeLogs = Array.isArray(serverLogs?.logs) ? serverLogs.logs : [];
  for (let start = 0; start < runtimeLogs.length || start === 0; start += 4) {
    pages.push([
      'Vercel runtime diagnostics',
      'Status: ' + (serverLogs?.status || 'unavailable') + ' | complete: ' +
        (serverLogs?.complete === true ? 'yes' : 'no'),
      'Coverage: ' + (serverLogs?.coverageFrom || 'Unavailable') + ' to ' +
        (serverLogs?.coverageTo || 'Unavailable'),
      serverLogs?.note || 'Vercel runtime logs are unavailable.',
      '',
      ...runtimeLogs.slice(start, start + 4).flatMap(log => [
        timestamp(log.recordedAt) + ' | ' + String(log.level || 'unknown').toUpperCase() +
          ' | ' + (log.method || 'Unavailable') + ' ' + (log.path || 'Unavailable') +
          ' | HTTP ' + (log.statusCode ?? 'Unavailable') + ' | request ' + (log.requestId || 'Unavailable'),
        'Deployment: ' + (log.deploymentId || 'Unavailable') + ' | Message: ' + (log.message || 'Unavailable'),
      ]),
      ...(!runtimeLogs.length ? ['No correlated Vercel runtime log entries were available.'] : []),
    ]);
  }
  // Only identify symbol families with known Deriv synthetic-index codes.
  const synthetic = rows.filter(trade => /^(?:R_(?:10|25|50|75|100)|1HZ(?:10|15|25|30|50|75|90|100|150|200|250)V|(?:BOOM|CRASH)\d+|JD\d+|stpRNG\d*|RD(?:BULL|BEAR))$/i.test(evidence?.[trade.contractId]?.symbol || ''));
  const cohorts = new Map();
  for (const trade of synthetic.slice().reverse()) {
    const detail = evidence[trade.contractId];
    const key = detail.symbol + ' | ' + (detail.strategy || 'Strategy unavailable');
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(trade);
  }
  const net = trades => trades.reduce((sum, trade) => sum + trade.value, 0);
  const groups = [...cohorts.entries()];
  for (let offset = 0; offset < groups.length || offset === 0; offset += 10) {
    pages.push([
      'Synthetic-index review',
      synthetic.length + ' identified synthetic-index settlements in this export.',
      'Recognized families: Volatility, Boom, Crash, Jump, Step and Range Break.',
      'Unidentified markets are excluded. Figures use settled P&L.',
      '',
      ...groups.slice(offset, offset + 10).flatMap(([name, trades]) => {
        const midpoint = Math.floor(trades.length / 2);
        const winCount = trades.filter(trade => trade.value > 0).length;
        return [
          name,
          trades.length + ' trades | ' + winCount + ' wins | Net ' + money(net(trades)),
          midpoint ? 'Earlier / later net: ' + money(net(trades.slice(0, midpoint))) + ' / ' + money(net(trades.slice(midpoint)))
            : 'One trade: too little data to compare periods.',
          '',
        ];
      }),
      ...(!groups.length ? ['No trades with a recognized synthetic-index symbol in this sample.'] : []),
    ]);
  }
  const scoreGroups = new Map();
  for (const trade of synthetic) {
    const detail = evidence?.[trade.contractId];
    if (!detail?.strategy || !Number.isFinite(detail.score)) continue;
    const label = detail.strategy + ' | ' + detail.score + '/100';
    if (!scoreGroups.has(label)) scoreGroups.set(label, []);
    scoreGroups.get(label).push(trade);
  }
  const scoreRows = [...scoreGroups.entries()];
  for (let offset = 0; offset < scoreRows.length; offset += 18) {
    pages.push([
      'Synthetic-index signal review',
      'Observed outcomes in this export. Signal scores are not win probabilities.',
      '',
      ...scoreRows.slice(offset, offset + 18).flatMap(([label, trades]) => [
        label,
        trades.filter(trade => trade.value > 0).length + '/' + trades.length + ' wins | Net ' + money(net(trades)),
      ]),
    ]);
  }
  const missingStrategy = rows.filter(trade => !evidence?.[trade.contractId]?.strategy).length;
  pages.push([
    'Suggested improvements',
    'Based on the settlements and evidence included in this report.',
    '',
    ...(fullLosses.length ? [
      '1. Review the ' + fullLosses.length + ' zero-proceeds losses first.',
      '   Early sale was often unavailable. The stop-loss cannot limit a binary loss below the stake.',
    ] : ['1. Review the largest losing positions and their recorded exit checks.']),
    '',
    '2. Do not treat signal score as a win probability. Validate the score on held-out trades.',
    '   Validate any entry rule out-of-sample on at least 500 settled trades across 3+ weeks.',
    '',
    '3. Check evidence coverage. ' + missingStrategy + ' settlements have no recorded strategy.',
    '   Entry indicators and technical failures are only available where diagnostic logging captured them.',
  ]);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, lines] of pages.entries()) {
    const stream = 'BT /F1 18 Tf 45 790 Td (' + pdfText(lines[0]) +
      ') Tj /F1 10 Tf 14 TL 0 -26 Td\n' +
      [...lines.slice(1).flatMap(line => wrapPdfLine(line)), 'Page ' + (index + 1) + ' of ' + pages.length]
        .map(line => '(' + pdfText(line) + ') Tj T*').join('\n') + '\nET';
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + index * 2) + ' 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  }
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const crossReference = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' +
    offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + crossReference + '\n%%EOF\n';
  saveReport(pdf, 'application/pdf', 'PlayGo-' + id + '-trade-report.pdf');
}
