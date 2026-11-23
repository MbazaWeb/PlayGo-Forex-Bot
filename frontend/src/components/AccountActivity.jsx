import React, { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

export default function AccountActivity({ accountId, currency, openAnalytics }) {
  const [contracts, setContracts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [review, setReview] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const fetchData = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/portfolio?account=' + encodeURIComponent(accountId), { signal });
      if (!r.ok) throw Error();
      const body = await r.json();
      if (body.accountId !== accountId || !Array.isArray(body.contracts)) throw Error();
      if (!signal?.aborted) setContracts(body.contracts);
    } catch {
      if (!signal?.aborted) setError('Open trades are unavailable.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

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
      await fetchData();
      setClosing(false);
    }
  }

  return (
    <section className="panel account-panel">
      <div className="panelhead">
        <h2>Open Trades</h2>
        <button type="button" className="outline" onClick={() => fetchData()} disabled={loading || closing}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {(error || notice) && <p role="status">{error || notice}</p>}
      {contracts?.length ? <div className="tablewrap">
        <table>
          <thead><tr><th>Trade</th><th>Open P&amp;L</th><th>Action</th></tr></thead>
          <tbody>{contracts.map(contract => <tr key={contract.id}>
            <td>{contract.symbol || 'Contract'} #{contract.id}</td>
            <td>{contract.profit > 0 ? '+' : ''}{contract.profit.toFixed(2)} {currency}</td>
            <td>{contract.canSell ? <button type="button" className="outline" disabled={closing || loading || Boolean(error)}
              onClick={() => setReview(contract)}>Close Trade</button> : <span className="muted">Wait for expiry</span>}</td>
          </tr>)}</tbody>
        </table>
      </div> : !loading && !error && <p>No open trades.</p>}
      <button type="button" className="textlink" onClick={openAnalytics}>View Analytics</button>
      {review && <ConfirmDialog title="Close trade" confirmLabel="Close at market"
        onCancel={() => setReview(null)}
        onConfirm={() => { setReview(null); void closeTrade(review); }}>
        <p>{review.symbol || 'Contract'} #{review.id}</p>
        <p>Deriv sets the final sale price when it executes the close.</p>
      </ConfirmDialog>}
    </section>
  );
}
