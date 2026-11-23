import React, { useState } from 'react';

export default function AccountActivity({ accountId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/portfolio?account=${accountId}`);
      if (!r.ok) throw new Error('Invalid response');
      const body = await r.json();
      setData(body);
    } catch (err) {
      setError('The account service returned an invalid response.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel account-panel">
      <div className="panelhead">
        <div>
          <h2>Account Activity</h2>
          <p>Broker account data</p>
        </div>
        <button className="outline" onClick={fetchData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh data'}
        </button>
      </div>

      {error && (
        <p role="status" className="signin-error">
          {error} <button className="textlink" onClick={fetchData}>Retry</button>
        </p>
      )}

      {data && (
        <div>
          <p>Contracts: {data.contracts?.length || 0}</p>
          <p>Observed at: {data.observedAt ? new Date(data.observedAt).toLocaleString() : 'Unknown'}</p>
        </div>
      )}

      {!data && !error && !loading && (
        <p className="muted">Click "Refresh data" to load.</p>
      )}
    </section>
  );
}