import React, { useRef, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

const settlementTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Africa/Dar_es_Salaam',
});

export default function AccountActivity({ accountId, currency, openAnalytics }) {
  const [view, setView] = useState('open');
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
        const r = await fetch('/api/portfolio?account=' + encodeURIComponent(accountId), { signal, cache: 'no-store' });
        if (!r.ok) throw Error();
        const body = await r.json();
        if (body.accountId !== accountId || !Array.isArray(body.contracts)) throw Error();
        if (!signal.aborted) {
          setContracts(body.contracts);
          setObservedAt(body.observedAt);
          setError('');
        }
      } catch {
        if (!signal.aborted) setError('Open trades are unavailable. Retrying…');
      } finally {
        busy = false;
        if (!signal.aborted) {
          setLoading(false);
          timer = setTimeout(refresh, pending ? 0 : 5000);
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
    if (view !== 'closed') return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer, busy = false, pending = false;
    async function refresh() {
      if (busy) { pending = true; return; }
      clearTimeout(timer);
      busy = true;
      try {
        const response = await fetch('/api/history?account=' + encodeURIComponent(accountId), { signal, cache: 'no-store' });
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
  }, [view, accountId]);

  async function closeTrade(contract) {
    setClosing(true);
    setNotice('');
    try {
      const query = new URLSearchParams({ account: accountId, contract: contract.id });
      const response = await fetch('/api/portfolio/close?' + query, {
        method: 'POST', headers: { 'X-PlayGo-Request': '1' },
      });
      const body = await response.json();
      setNotice(response.ok && body.closed ? 'Trade closed. View the settlement under Closed.' : body.error || 'Close status unavailable.');
      if (response.ok && body.closed) {
        setContracts(rows => rows?.filter(row => row.id !== contract.id) ?? []);
        window.dispatchEvent(new CustomEvent('playgo:settlement', { detail: accountId }));
      }
    } catch {
      setNotice('Close status unavailable. Check open trades before retrying.');
    } finally {
      refreshRef.current?.();
      setClosing(false);
    }
  }

  const net = contracts?.reduce((sum, row) => sum + row.profit, 0) ?? 0;
  const tone = value => value > 0 ? 'gain' : value < 0 ? 'loss' : '';
  const money = value => (value > 0 ? '+' : '') + value.toFixed(2) + ' ' + currency;
  return (
    <section className="panel account-panel">
      <div className="panelhead">
        <div><h2>Trades</h2>{view === 'open' && observedAt && <small>{error ? 'Last available' : 'Updated'} {new Date(observedAt).toLocaleTimeString()}</small>}</div>
        <button type="button" className="outline" onClick={() => view === 'open' ? refreshRef.current?.() : historyRefreshRef.current?.()} disabled={closing || (view === 'open' && loading)}>
          {view === 'open' && loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <div className="panelhead" role="group" aria-label="Trade status">
        <div>
          <button type="button" className={view === 'open' ? 'primary' : 'outline'} aria-pressed={view === 'open'} onClick={() => setView('open')}>
            Open{contracts && ' (' + contracts.length + ')'}
          </button>{' '}
          <button type="button" className={view === 'closed' ? 'primary' : 'outline'} aria-pressed={view === 'closed'} onClick={() => setView('closed')}>
            Closed{settled && ' (' + settled.length + ')'}
          </button>
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
      {view === 'open' && error && <p role="status">{error}</p>}
      {view === 'open' && (contracts?.length ? <>
        <p>Total open P&amp;L <strong className={tone(net)}>{money(net)}</strong></p>
        <ul className="open-positions">{contracts.map(contract => <li key={contract.id}>
          <div><strong>{contract.symbol || 'Contract'} · {({ CALL: 'Rise', PUT: 'Fall' })[contract.contractType] || contract.contractType || 'Open'}</strong>
            <small>#{contract.id} · Stake {contract.stake} {currency}</small>
            <span>Entry {contract.entrySpot ?? '—'} → Now {contract.currentSpot ?? '—'}</span></div>
          <div><strong className={tone(contract.profit)}>{money(contract.profit)}</strong>
            {contract.canSell ? <button type="button" className="outline" disabled={closing || Boolean(error)}
              onClick={() => setReview(contract)}>Close Trade</button> : <small>Wait for expiry</small>}</div>
        </li>)}</ul>
      </> : !error && <p>{contracts ? 'No open trades.' : 'Checking open trades…'}</p>)}
      {view === 'closed' && <>
        {historyError && <p role="status">{settled ? 'Showing last available settlements. Retrying…' : 'Closed trades are unavailable. Retrying…'}</p>}
        {settled?.length ? <ul className="open-positions" aria-label="Recent closed trades">
          {settled.map(trade => {
            const profit = trade.sell - trade.buy;
            const outcome = profit > 0 ? 'Win' : profit < 0 ? 'Loss' : 'Break-even';
            const hasTime = Number.isSafeInteger(trade.settledAt) && trade.settledAt > 0 && trade.settledAt < 1e11;
            return <li key={trade.id}>
              <div><strong>{trade.contractId ? 'Contract #' + trade.contractId : 'Transaction #' + trade.id}</strong>
                {hasTime && <small><time dateTime={new Date(trade.settledAt * 1000).toISOString()}>{settlementTime.format(trade.settledAt * 1000)} EAT</time></small>}
              </div>
              <div><strong className={tone(profit)}>{money(profit)}</strong><small>{outcome}</small></div>
            </li>;
          })}
        </ul> : !historyError && <p>{settled ? 'No closed trades.' : 'Checking closed trades…'}</p>}
      </>}
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
