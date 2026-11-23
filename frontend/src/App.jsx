import ConfirmDialog from './components/ConfirmDialog';
import React, { useEffect, useState } from 'react';
import {
  Activity, LogOut, ShieldCheck, LayoutDashboard, Wallet,
  ChartCandlestick, ChartNoAxesCombined, Settings, Menu, X,
} from 'lucide-react';
import AccountDashboard from './components/AccountDashboard';
import TradeAgent from './components/TradeAgent';

const MarketWorkspace = React.lazy(() => import('./components/MarketWorkspace'));

const NAV = [
  ['Overview', LayoutDashboard],
  ['Trading Terminal', ChartCandlestick],
  ['Bot Agents', Wallet],
  ['Analytics', ChartNoAxesCombined],
  ['Settings', Settings],
];

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { res, body };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [pendingAccountId, setPendingAccountId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mt5, setMt5] = useState(null);
  const [page, setPage] = useState('Overview');
  const [mobile, setMobile] = useState(false);
  const [marketSymbol, setMarketSymbol] = useState('');

  async function load() {
    setLoading(true); setError(''); setAccounts(null); setMt5(null);
    try {
      const { res, body: s } = await fetchJSON('/api/session');
      if (!res.ok) throw new Error('Account service unavailable.');
      setSession(s);
      if (s?.authenticated) {
        const { res: aRes, body: aBody } = await fetchJSON('/api/accounts');
        if (!aRes.ok) {
          if (aRes.status === 401) setSession({ ...s, authenticated: false });
          throw new Error(aBody?.error || 'Could not load accounts');
        }
        setAccounts(Array.isArray(aBody?.accounts) ? aBody.accounts : []);
        try {
          const { res: mRes, body: mBody } = await fetchJSON('/api/mt5/status');
          setMt5(mRes.ok ? mBody : { status: 'unavailable' });
        } catch { setMt5({ status: 'unavailable' }); }
      }
    } catch (e) {
      setError(e?.message || 'Unexpected error');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-PlayGo-Request': '1' } }); } catch {}
    setSelectedAccountId(''); setAccounts(null); load();
  }

  if (!session?.authenticated) {
    return (
      <div className="signin">
        <header>
          <div className="brand">
            <span className="brandicon"><Activity size={21} /></span>
            <div><b>PLAYGO</b><small>TRADING TERMINAL</small></div>
          </div>
        </header>
        <main className="signin-main">
          <h1>Sign in to PlayGo</h1>
          <p>Sign in with Deriv to access your trading accounts.</p>
          {error && <p role="alert" className="signin-error">Sign-in unavailable. <button onClick={load}>Try again</button></p>}
          {loading ? <p role="status">Checking session...</p>
            : session?.configured
              ? <a className="signin-action" href="/api/auth/deriv/start">Continue with Deriv <span aria-hidden="true">&rarr;</span></a>
              : !error && <p role="status" className="signin-error">Deriv sign-in is not configured.</p>}
        </main>
      </div>
    );
  }

  function navigate(next, symbol) {
    if (symbol) setMarketSymbol(symbol);
    setPage(next === 'Accounts' || next === 'Portfolio' ? 'Bot Agents' : next);
    setMobile(false);
  }

  const selectedAccount = accounts?.find(account => account.account_id === selectedAccountId);
  function selectAccount(accountId) {
    if (accountId === selectedAccountId) return;
    if (selectedAccount) setPendingAccountId(accountId);
    else setSelectedAccountId(accountId);
  }
  const selectedAccounts = selectedAccount ? [selectedAccount] : [];

  return (
    <div className="app">
      <aside className={'sidebar ' + (mobile ? 'show' : '')}>
        <div className="brand">
          <span className="brandicon"><Activity size={22} /></span>
          <div><b>PLAYGO</b><small>TRADING TERMINAL</small></div>
          <button className="mobile-close" onClick={() => setMobile(false)} aria-label="Close menu"><X size={20} /></button>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {NAV.map(([name, Icon]) => (
            <button key={name} className={page === name ? 'selected' : ''} aria-current={page === name ? 'page' : undefined} onClick={() => navigate(name)}>
              <Icon size={19} />{name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection"><span className="dot" /> Deriv connected <ShieldCheck size={16} /></div>
        </div>
      </aside>
      {mobile && <button className="account-menu-backdrop" aria-label="Close navigation" onClick={() => setMobile(false)} />}
      <div className="main">
        <header className="topbar">
          <div className="top-left">
            <button className="hamburger" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu size={23} /></button>
            <span className="breadcrumb">Workspace</span><span className="slash">/</span><b>{page}</b>
          </div>
                    <div className="top-right">
            {!!accounts?.length && (
              <select className="outline" aria-label="Deriv trading account" value={selectedAccount?.account_id || ''}
                onChange={event => selectAccount(event.target.value)}>
                <option value="" disabled>Select Deriv account</option>
                {accounts.map(account => (
                  <option key={account.account_id} value={account.account_id}>
                    {account.account_type === 'demo' ? 'Demo' : 'Real'} · {account.account_id}
                  </option>
                ))}
              </select>
            )}
            <button className="outline" onClick={logout}><LogOut size={16} /> Sign out</button>
          </div>
        </header>
        <main className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">PLAYGO TRADING WORKSPACE</div>
              <h1>{page}</h1>
              <p>Connected Deriv session</p>
            </div>
          </div>
          {error && <div role="alert" className="notice">{error}<button onClick={load}>Retry</button></div>}
          {loading && <p role="status">Loading...</p>}
          {!loading && page === 'Overview' && <AccountDashboard accounts={selectedAccounts} mt5={mt5} navigate={navigate} marketSymbol={marketSymbol} onMarketChange={setMarketSymbol} />}
          {!loading && page === 'Bot Agents' && <TradeAgent key={selectedAccountId} account={selectedAccount} marketSymbol={marketSymbol} onMarketChange={setMarketSymbol} realExecutionEnabled={session.execution === true} />}
          {!loading && page === 'Trading Terminal' && (
            <React.Suspense fallback={<p>Loading...</p>}>
              <MarketWorkspace page="Trading Terminal" marketSymbol={marketSymbol} onMarketChange={setMarketSymbol} account={selectedAccount} accounts={accounts} onSelectAccount={selectAccount} executionEnabled={session.execution === true} changePage={navigate} />
            </React.Suspense>
          )}
          {!loading && page === 'Analytics' && <AccountDashboard accounts={selectedAccounts} mt5={mt5} navigate={navigate} analytics />}
          {!loading && page === 'Settings' && (
            <section className="panel">
              <h2>Connections</h2>
              <div className="setting-line"><span>Deriv</span><strong>Connected</strong></div>
              <div className="setting-line"><span>MetaTrader 5</span><strong>{mt5?.status || 'Not linked'}</strong></div>
              <div className="setting-line"><span>Accounts</span><strong>{accounts?.length ?? 0} connected</strong></div>
            </section>
          )}
        </main>
      </div>
      {pendingAccountId && <ConfirmDialog title="Switch Deriv account" confirmLabel="Switch account"
        onCancel={() => setPendingAccountId('')}
        onConfirm={() => { setSelectedAccountId(pendingAccountId); setPendingAccountId(''); }}>
        <p>Bot Agents will pause monitoring the current account until you select it again.</p>
      </ConfirmDialog>}
    </div>
  );
}