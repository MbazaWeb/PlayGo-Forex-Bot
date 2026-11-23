import { brokerRequest } from './brokerRequest';
import React, { useRef, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

const settlementTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Africa/Dar_es_Salaam',
});

export default function AccountActivity({ accountId, currency, openAnalytics }) {
  const [settled, setSettled] = useState(null);
  const [historyError, setHistoryError] = useState(false);
  const historyRefreshRef = useRef(null);
  const [contracts, setContracts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [review, setReview] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refreshRef = useRef(null);
  const [observedAt, setObservedAt] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer, pending = false, busy = false;
    async function refresh() {
      if (busy) { pending = true; return; }
      clearTimeout(timer);
      busy = true;
      setLoading(true);
      try {
        const r = await brokerRequest('/api/portfolio?account=' + encodeURIComponent(accountId), { signal, cache: 'no-store' });
        if (r.status === 429) throw Error('Deriv is busy. Showing the last available positions while PlayGo waits.');
        if (!r.ok) throw Error();
        const body = await r.json();
        if (body.accountId !== accountId || !Array.isArray(body.contracts)) throw Error();
        if (!signal.aborted) {
          setContracts(body.contracts);
          setObservedAt(body.observedAt);
          setError('');
        }
      } catch (error) {
        if (!signal.aborted) setError(error.message || 'Open trades are unavailable. Retrying…');
      } finally {
        busy = false;
        if (!signal.aborted) {
          setLoading(false);
          timer = setTimeout(refresh, pending ? 5000 : 12000);
          pending = false;
        }
      }
    }
    function onChange(event) { if (event.detail === accountId) void refresh(); }
    refreshRef.current = refresh;
    window.addEventListener('playgo:position', onChange);
    window.addEventListener('playgo:settlement', onChange);
    void refresh();
    return () => {
      clearTimeout(timer);
      controller.abort();
      refreshRef.current = null;
      window.removeEventListener('playgo:position', onChange);
      window.removeEventListener('playgo:settlement', onChange);
    };
  }, [accountId]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer, busy = false, pending = false;
    async function refresh() {
      if (busy) { pending = true; return; }
      clearTimeout(timer);
      busy = true;
      try {
        const response = await brokerRequest('/api/history?account=' + encodeURIComponent(accountId), { signal, cache: 'no-store' });
        if (!response.ok) throw Error();
        const body = await response.json();
        if (body.accountId !== accountId || !Array.isArray(body.transactions)) throw Error();
        if (!signal.aborted) {
          setSettled(body.transactions);
          setHistoryError(false);
        }
      } catch {
        if (!signal.aborted) setHistoryError(true);
      } finally {
        busy = false;
        if (!signal.aborted) {
          timer = setTimeout(refresh, pending ? 0 : 15000);
          pending = false;
        }
      }
    }
    function onSettlement(event) { if (event.detail === accountId) void refresh(); }
    historyRefreshRef.current = refresh;
    window.addEventListener('playgo:settlement', onSettlement);
    void refresh();
    return () => {
      clearTimeout(timer);
      controller.abort();
      historyRefreshRef.current = null;
      window.removeEventListener('playgo:settlement', onSettlement);
    };
  }, [accountId]);

  async function closeTrade(contract) {
    setClosing(true);
    setNotice('');
    try {
      const query = new URLSearchParams({ account: accountId, contract: contract.id });
      const response = await brokerRequest('/api/portfolio/close?' + query, {
        method: 'POST', headers: { 'X-PlayGo-Request': '1' },
      });
      if (response.status === 429) { setNotice("Deriv is busy. Wait before trying to close again."); return; }
      const body = await response.json();
      setNotice(response.ok && body.closed ? 'Trade closed. Waiting for Deriv settlement.' : body.error || 'Close status unavailable.');
      if (response.ok && body.closed) {
        setContracts(rows => rows?.filter(row => row.id !== contract.id) ?? []);
        window.dispatchEvent(new CustomEvent('playgo:settlement', { detail: accountId }));
        return;
      }
    } catch {
      setNotice('Close status unavailable. Check open trades before retrying.');
    } finally {
      setClosing(false);
    }
  }

  const tone = value => value > 0 ? 'gain' : value < 0 ? 'loss' : '';
  const money = value => (value > 0 ? '+' : '') + value.toFixed(2) + ' ' + currency;
  const settledIds = new Set(settled?.slice().sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0)).map(trade => trade.contractId));
  const openRows = (contracts ?? []).filter(contract => !settledIds.has(contract.id));
  const net = openRows.reduce((sum, row) => sum + row.profit, 0);
  return (
    <section className="panel account-panel">
      <div className="panelhead">
        <div><h2>Trades</h2>{observedAt && <small>{error ? 'Last available' : 'Updated'} {new Date(observedAt).toLocaleTimeString()}</small>}</div>
        <button type="button" className="outline" onClick={() => {
          refreshRef.current?.();
          historyRefreshRef.current?.();
        }} disabled={loading || closing}>Refresh</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="status">{error}</p>}
      {historyError && <p role="status">{settled ? 'Showing last available settlements.' : 'Closed trades are unavailable.'}</p>}
      <div className="trades-summary">
        {contracts && <span><strong>{openRows.length}</strong> open</span>}
        {settled && <span><strong>{settled.length}</strong> recent settlements</span>}
        {contracts && <span>Open P&amp;L <strong className={tone(net)}>{money(net)}</strong></span>}
      </div>
      <div className="tablewrap">
        <table className="account-trades-table" aria-label="Open trades and recent settlements">
          <thead><tr><th scope="col">Trade</th><th scope="col">Status</th><th scope="col">P&amp;L</th><th scope="col">Settled (EAT)</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {openRows.map(contract => (
              <tr key={'open-' + contract.id}>
                <td><strong>{contract.symbol || 'Contract'} · {({ CALL: 'Rise', PUT: 'Fall' })[contract.contractType] || contract.contractType || 'Open'}</strong><br />
                  <small>#{contract.id} · Stake {contract.stake} {currency}</small><br />
                  <small>Entry {contract.entrySpot ?? '—'} → Now {contract.currentSpot ?? '—'}</small></td>
                <td><span className="trade-outcome" data-outcome="Open">Open</span></td>
                <td><strong className={tone(contract.profit)}>{money(contract.profit)}</strong></td>
                <td>—</td>
                <td>{contract.canSell ? <button type="button" className="outline" disabled={closing || Boolean(error)}
                  onClick={() => setReview(contract)}>Close Trade</button> : <small>Wait for expiry</small>}</td>
              </tr>
            ))}
            {settled?.map(trade => {
              const profit = trade.sell - trade.buy;
              const outcome = profit > 0 ? 'Win' : profit < 0 ? 'Loss' : 'Break-even';
              const hasTime = Number.isSafeInteger(trade.settledAt) && trade.settledAt > 0 && trade.settledAt < 1e11;
              return <tr key={'closed-' + trade.id}>
                <td>{trade.contractId ? 'Contract #' + trade.contractId : 'Transaction #' + trade.id}</td>
                <td><span className="trade-outcome" data-outcome={outcome}>Closed · {outcome}</span></td>
                <td data-outcome={outcome}><strong className={tone(profit)}>{money(profit)}</strong></td>
                <td>{hasTime ? <time dateTime={new Date(trade.settledAt * 1000).toISOString()}>{settlementTime.format(trade.settledAt * 1000)}</time> : '—'}</td>
                <td>—</td>
              </tr>;
            })}
            {openRows.length === 0 && !settled?.length && !error && !historyError &&
              <tr><td colSpan={5}>{contracts && settled ? 'No trades to display.' : 'Checking trades…'}</td></tr>}
          </tbody>
        </table>
      </div>
      {openAnalytics && <button type="button" className="textlink" onClick={openAnalytics}>View Analytics</button>}
      {review && <ConfirmDialog title="Close trade" confirmLabel="Close at market"
        onCancel={() => setReview(null)}
        onConfirm={() => { setReview(null); void closeTrade(review); }}>
        <p>{review.symbol || 'Contract'} #{review.id}</p>
        <p>Deriv sets the final sale price when it executes the close.</p>
      </ConfirmDialog>}
    </section>
  );
}
