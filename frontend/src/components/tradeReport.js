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

export function downloadTradeReport({ id, currency, points, performance, wins, losses, even, settlementFormat }) {
  const summary = [
    ['Metric', 'Value'], ['Account', id], ['Currency', currency],
    ['Scope', 'Recent Deriv settlements, including bot and manual trades'],
    ['Settled trades', points.length], ['Wins', wins], ['Losses', losses], ['Break-even', even],
    ['Win rate (%)', 100 * wins / points.length], ['Net P&L', performance.net],
    ['Average P&L', performance.average], ['Profit factor', performance.profitFactor],
    ['Maximum drawdown', performance.drawdown], ['Average win', performance.averageWin],
    ['Average loss', performance.averageLoss],
  ];
  const details = [
    ['Transaction', 'Contract', 'Settled (EAT)', 'Outcome', 'Buy price', 'Sell proceeds', 'P&L', 'Strategy', 'Loss review'],
    ...points.slice().sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0)).map(trade => {
      const validTime = Number.isSafeInteger(trade.settledAt) && trade.settledAt > 0 && trade.settledAt < 1e11;
      return [trade.time, trade.contractId, validTime ? settlementFormat.format(trade.settledAt * 1000) : 'Unavailable',
        trade.status, trade.buy, trade.sell, trade.value, 'Unavailable',
        trade.value < 0 ? 'Sell proceeds were below buy price. Entry signal and exit cause are unavailable in settlement history.' : ''];
    }),
  ];
  const workbook = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    sheet('Summary', summary) + sheet('Closed trades', details) + '</Workbook>';
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

export function downloadTradePdf({ id, currency, points, performance, wins, losses, even, settlementFormat, evidence }) {
  const money = value => Number.isFinite(value) ? value.toFixed(2) + ' ' + currency : 'Unavailable';
  const fullLosses = points.filter(trade => trade.value < 0 && trade.sell === 0);
  const rows = points.slice().sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0));
  const pages = [[
    'PlayGo trade review',
    'Account ' + id + ' | ' + currency + ' | ' + new Date().toISOString().slice(0, 10),
    'Scope: ' + points.length + ' recent settled Deriv trades, including bot and manual.',
    '',
    'RESULTS',
    'Wins: ' + wins + ' | Losses: ' + losses + ' | Break-even: ' + even,
    'Win rate: ' + (wins / points.length * 100).toFixed(1) + '%',
    'Net P&L: ' + money(performance.net) + ' | Average per trade: ' + money(performance.average),
    'Profit factor: ' + (performance.profitFactor?.toFixed(2) ?? 'Unavailable'),
    'Average win: ' + money(performance.averageWin) + ' | Average loss: ' + money(performance.averageLoss),
    'Maximum drawdown: ' + money(performance.drawdown),
    'Zero-proceeds losses: ' + fullLosses.length + ' | P&L: ' + money(fullLosses.reduce((sum, trade) => sum + trade.value, 0)),
    '',
    evidence ? 'Evidence includes entries and recent exit checks recorded by PlayGo.'
      : 'PlayGo audit data was unavailable at the time of export.',
  ]];
  for (let start = 0; start < rows.length; start += 6) {
    pages.push(['Closed trades | EAT', 'Buy price, proceeds and net P&L in ' + currency, '',
      ...rows.slice(start, start + 6).flatMap(trade => {
        const validTime = Number.isSafeInteger(trade.settledAt) && trade.settledAt > 0 && trade.settledAt < 1e11;
        const detail = evidence?.[trade.contractId];
        const exit = detail?.exit;
        return [
          (validTime ? settlementFormat.format(trade.settledAt * 1000) : 'Time unavailable') + ' | ' + trade.status,
          'Transaction ' + trade.time + ' | Contract ' + (trade.contractId || 'Unavailable'),
          'Buy ' + money(trade.buy) + ' | Proceeds ' + money(trade.sell) + ' | Net ' + money(trade.value),
          'Strategy: ' + (detail?.strategy || 'Unavailable') + (Number.isFinite(detail?.score) ? ' | Signal score: ' + detail.score + '/100' : ''),
          'Market: ' + (detail?.symbol || 'Unavailable') + ' | Direction: ' +
            ({ CALL: 'Rise', PUT: 'Fall' }[detail?.direction] || 'Unavailable') + (detail?.duration ? ' | ' + detail.duration + ' min' : ''),
          ...(trade.value < 0 ? [trade.sell === 0 ? 'Loss: zero proceeds; the full stake was lost.' : 'Loss: sale proceeds were below the stake.'] : []),
          exit?.outcome === 'CLOSED' ? 'Exit audit: Deriv confirmed an early close.'
            : exit?.canSell === false ? 'Exit audit: Deriv did not offer early sale at the recorded check.'
              : exit ? 'Exit audit: PlayGo did not receive close confirmation.'
                : 'Exit audit: unavailable. Exact exit cause cannot be established.',
          '',
        ];
      }),
    ]);
  }
  // Only identify symbol families with known Deriv synthetic-index codes.
  const synthetic = rows.filter(trade => /^(?:R_(?:10|25|50|75|100)|1HZ(?:10|15|25|30|50|75|90|100|150|200|250)V|(?:BOOM|CRASH)\d+|JD\d+)$/i.test(evidence?.[trade.contractId]?.symbol || ''));
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
      'Recognized families: Volatility, Boom, Crash and Jump.',
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
  const missingStrategy = rows.filter(trade => !evidence?.[trade.contractId]?.strategy).length;
  pages.push([
    'Suggested improvements',
    'Based on the settlements and evidence included in this report.',
    '',
    ...(fullLosses.length ? [
      '1. Review the ' + fullLosses.length + ' zero-proceeds losses first.',
      '   On Demo, compare stake caps and record when early sale is available.',
    ] : ['1. Review the largest losing positions and their recorded exit checks.']),
    '',
    '2. Compare strategies on Demo using the same stake, market and test period.',
    '   Compare net P&L, drawdown and average outcome before changing entry rules.',
    '   Then test any proposed change on a separate Demo period before adopting it.',
    '',
    '3. Check evidence coverage. ' + missingStrategy + ' settlements have no recorded strategy.',
    '   Capture the entry signal and early-sale outcome for trades with missing evidence.',
  ]);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, lines] of pages.entries()) {
    const stream = 'BT /F1 18 Tf 45 790 Td (' + pdfText(lines[0]) +
      ') Tj /F1 10 Tf 14 TL 0 -26 Td\n' +
      [...lines.slice(1), 'Page ' + (index + 1) + ' of ' + pages.length].map(line => '(' + pdfText(line) + ') Tj T*').join('\n') + '\nET';
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
