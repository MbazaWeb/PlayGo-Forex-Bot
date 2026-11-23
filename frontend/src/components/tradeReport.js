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
  const url = URL.createObjectURL(new Blob([workbook], { type: 'application/xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'PlayGo-' + id + '-trade-report.xml';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
