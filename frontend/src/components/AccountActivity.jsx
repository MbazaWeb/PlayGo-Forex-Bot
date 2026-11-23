import React, { useRef, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

export default function AccountActivity({ accountId, currency, openAnalytics }) {
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
    void refresh();
    return () => {
      clearTimeout(timer);
      controller.abort();
      refreshRef.current = null;
      window.removeEventListener('playgo:position', onChange);
    };
  }, [accountId]);

  async function closeTrade(contract) {
    setClosing(true);
    setNotice('');
    try {
      const query = new URLSearchParams({ account: accountId, contract: contract.id });
      const response = await fetch('/api/portfolio/close?' + query, {
        method: 'POST', headers: { 'X-PlayGo-Request': '1' },
      });
      const body = await response.json();
      setNotice(response.ok && body.closed ? 'Trade closed. View settlement in Analytics.' : body.error || 'Close status unavailable.');
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
        <div><h2>Open Trades</h2>{observedAt && <small>{error ? 'Last available' : 'Updated'} {new Date(observedAt).toLocaleTimeString()}</small>}</div>
        <button type="button" className="outline" onClick={() => refreshRef.current?.()} disabled={loading || closing}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {(error || notice) && <p role="status">{error || notice}</p>}
      {contracts?.length ? <>
        <p>Total open P&amp;L <strong className={tone(net)}>{money(net)}</strong></p>
        <ul className="open-positions">{contracts.map(contract => <li key={contract.id}>
          <div><strong>{contract.symbol || 'Contract'} · {({ CALL: 'Rise', PUT: 'Fall' })[contract.contractType] || contract.contractType || 'Open'}</strong>
            <small>#{contract.id} · Stake {contract.stake} {currency}</small>
            <span>Entry {contract.entrySpot ?? '—'} → Now {contract.currentSpot ?? '—'}</span></div>
          <div><strong className={tone(contract.profit)}>{money(contract.profit)}</strong>
            {contract.canSell ? <button type="button" className="outline" disabled={closing || Boolean(error)}
              onClick={() => setReview(contract)}>Close Trade</button> : <small>Wait for expiry</small>}</div>
        </li>)}</ul>
      </> : !error && <p>{contracts ? 'No open trades.' : 'Checking open trades…'}</p>}
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
