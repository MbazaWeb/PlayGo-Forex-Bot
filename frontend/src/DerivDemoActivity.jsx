import React, { useEffect, useState } from 'react';
import { normalizeDemoActivity } from './components/demoAccountActivity.js';

async function getJson(path, signal) {
  const response = await fetch(path, { signal });
  if (response.status === 401) throw Error('SESSION_EXPIRED');
  if (response.status === 403) throw Error('DEMO_ACCOUNT_REQUIRED');
  if (response.status === 429) throw Error('RATE_LIMITED');
  if (!response.ok) throw Error('BROKER_UNAVAILABLE');
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') throw Error('INVALID_API_RESPONSE');
  return body;
}

function errorText(error) {
  switch (error) {
    case 'SESSION_EXPIRED': return 'Deriv session expired. Sign in again to view demo account data.';
    case 'DEMO_ACCOUNT_REQUIRED': return 'The selected Deriv account is not a demo account.';
    case 'RATE_LIMITED': return 'Deriv rate limit reached. Wait before refreshing.';
    case 'INVALID_API_RESPONSE': return 'The account service returned an invalid response.';
    default: return 'Deriv demo account data is unavailable. Try again.';
  }
}

function displayAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : 'Unavailable';
}

export default function PaperTerminal({ account }) {
  const accountId = account?.account_id;
  const [snapshot, setSnapshot] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!accountId) {
      setSnapshot(null);
      return;
    }

    const controller = new AbortController();
    setSnapshot({ accountId, loading: true });

    async function load() {
      const query = new URLSearchParams({ account: accountId });
      const [accounts, portfolio, history] = await Promise.all([
        getJson('/api/accounts', controller.signal),
        getJson('/api/demo/portfolio?' + query, controller.signal),
        getJson('/api/demo/history?' + query, controller.signal),
      ]);
      const activity = normalizeDemoActivity({ accountId, accounts: accounts.accounts, portfolio, history });
      if (!controller.signal.aborted) setSnapshot({ accountId, ...activity });
    }

    load().catch((error) => {
      if (!controller.signal.aborted) {
        setSnapshot({ accountId, error: error?.message || 'BROKER_UNAVAILABLE' });
      }
    });

    return () => controller.abort();
  }, [accountId, refresh]);

  const current = snapshot?.accountId === accountId ? snapshot : null;
  const details = current?.account;
  const currency = details?.currency || account?.currency || '';

  return (
    <section className="panel demo-account-panel" aria-label="Deriv demo account activity">
      <div className="panelhead">
        <div>
          <h2>Deriv Demo Account</h2>
          <p>{accountId ? 'Broker account activity · ' + accountId : 'Connect a Deriv demo account to continue.'}</p>
        </div>
        {accountId && (
          <button className="outline" disabled={current?.loading} onClick={() => setRefresh((n) => n + 1)}>
            {current?.loading ? 'Refreshing...' : 'Refresh broker data'}
          </button>
        )}
      </div>

      {accountId && (
        <div className="demo-account-notice" role="note">
          <strong>Deriv demo funds</strong>
          <p>This panel reads the selected demo account. Place Rise/Fall contracts using the order ticket above; orders use Deriv virtual funds and follow Deriv contract settlement.</p>
        </div>
      )}

      {details && (
        <div className="demo-account-balance">
          <small>Demo balance from Deriv</small>
          <strong>{details.balance == null ? 'Unavailable' : `${details.balance} ${currency}`}</strong>
        </div>
      )}

      {current?.loading && <p role="status">Loading authenticated Deriv demo data...</p>}
      {current?.error && (
        <div role="alert" className="demo-account-error">
          <p>{errorText(current.error)}</p>
          {current.error === 'SESSION_EXPIRED' && <a href="/api/auth/deriv/start">Sign in with Deriv</a>}
          <button className="textlink" onClick={() => setRefresh((n) => n + 1)}>Retry</button>
        </div>
      )}

      {current?.contracts && (
        <>
          <div className="demo-activity-heading">
            <h3>Open demo contracts</h3>
            <small>Observed {current.portfolioObservedAt ? new Date(current.portfolioObservedAt).toLocaleString() : 'time unavailable'}</small>
          </div>
          {current.contracts.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Contract</th><th>Market</th></tr></thead>
                <tbody>
                  {current.contracts.map((contract) => (
                    <tr key={contract.id}>
                      <td>{contract.id}</td>
                      <td>{contract.symbol || 'Unavailable'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p>No open demo contracts.</p>}

          <div className="demo-activity-heading">
            <h3>Recent closed demo trades</h3>
            <small>Observed {current.historyObservedAt ? new Date(current.historyObservedAt).toLocaleString() : 'time unavailable'}</small>
          </div>
          {current.transactions.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Transaction</th><th>Buy</th><th>Sell</th><th>Net result</th></tr></thead>
                <tbody>
                  {current.transactions.map((transaction) => {
                    const pnl = Number(transaction.sell) - Number(transaction.buy);
                    return (
                      <tr key={transaction.id}>
                        <td>{transaction.id}</td>
                        <td>{displayAmount(transaction.buy)} {currency}</td>
                        <td>{displayAmount(transaction.sell)} {currency}</td>
                        <td className={pnl > 0 ? 'gain' : pnl < 0 ? 'loss' : undefined}>
                          {Number.isFinite(pnl) ? displayAmount(pnl) + ' ' + currency : 'Unavailable'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p>No closed demo trades reported.</p>}
        </>
      )}
    </section>
  );
}
