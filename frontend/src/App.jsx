import React, { useEffect, useState } from 'react';
import {
  Activity, LogOut, RefreshCw, ShieldCheck, LayoutDashboard, Wallet,
  ChartCandlestick, Bot, ChartNoAxesCombined, Settings, Menu, X,
} from 'lucide-react';
import AccountDashboard from './components/AccountDashboard';
import Strategy from './components/strategy';
import Portfolio from './components/portfolio';

const MarketWorkspace = React.lazy(() => import('./components/MarketWorkspace'));
const PaperTerminal = React.lazy(() => import('./PaperTerminal'));

const NAV = [
  ['Overview', LayoutDashboard],
  ['Trading Terminal', ChartCandlestick],
  ['Trading Bots', Bot],
  ['Portfolio', Wallet],
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mt5, setMt5] = useState(null);
  const [page, setPage] = useState('Overview');
  const [mobile, setMobile] = useState(false);
  const [mt5Guide, setMt5Guide] = useState(false);
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [terminalSymbol, setTerminalSymbol] = useState('R_75');

  async function load() {
    setLoading(true); setError(''); setAccounts(null); setMt5(null);
    try {
      const { res, body: s } = await fetchJSON('/api/session');
      if (!res.ok) throw new Error('Account service unavailable. Start the backend.');
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
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-PlayGo-Request': '1' } });
    } catch { /* ignore */ }
    setAccounts(null); load();
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
          <p>Choose a trading connection. Deriv uses secure browser sign-in; MT5 uses its Windows desktop terminal.</p>
          {error && <p role="alert" className="signin-error">Sign-in service unavailable. <button onClick={load}>Try again</button></p>}
          {!error && new URLSearchParams(location.search).has('auth_error') && (
            <p role="alert" className="signin-error">Deriv sign-in failed. Please try again.</p>
          )}
          {loading ? <p role="status">Checking your session...</p>
            : session?.configured
              ? <a className="signin-action" href="/api/auth/deriv/start">Continue with Deriv <span aria-hidden="true">→</span></a>
              : !error && <p role="status" className="signin-error">Deriv sign-in is unavailable until the server is configured.</p>}
          <button className="signin-action signin-mt5" onClick={() => setMt5Guide((v) => !v)}>
            Connect MetaTrader 5 <span aria-hidden="true">→</span>
          </button>
          {mt5Guide && (
            <section className="mt5-guide">
              <h2>MetaTrader 5 connection</h2>
              <p>MT5 does not offer a universal browser OAuth redirect. Open the Windows MT5 terminal, sign in to your broker account there, then start the PlayGo local bridge.</p>
              <p>Local bridge: <code>http://127.0.0.1:8765/status</code></p>
              <p>The bridge is not yet synchronized with this website. MT5-only PlayGo authentication requires a separate secure pairing flow and is not active.</p>
              <a href="https://www.metatrader5.com/en/download" target="_blank" rel="noopener noreferrer">Get MetaTrader 5 desktop</a>
            </section>
          )}
        </main>
      </div>
    );
  }

  function navigate(next, symbol) {
    if (next !== 'Trading Terminal') setLedgerLoaded(false);
    if (symbol) setTerminalSymbol(symbol);
    setPage(next === 'Accounts' ? 'Portfolio' : next);
    setMobile(false);
  }

  const demoAccounts = (accounts || []).filter((a) =>
    a.account_type === 'demo' && typeof a.account_id === 'string' && a.account_id,
  );

  const accountsView = (
    <>
      <section className="panel account-panel">
        <div className="panelhead">
          <div><h2>Deriv demo accounts</h2><p>Real-money accounts are not shown in this workspace.</p></div>
          <button className="outline" onClick={load}><RefreshCw size={16} /> Refresh</button>
        </div>
        {demoAccounts.length ? demoAccounts.map((a) => (
          <div className="setting-line" key={a.account_id}>
            <div>
              <b>{a.account_id}</b>
              <p>{a.account_type || 'Type unavailable'} - {a.currency || 'Currency unavailable'}</p>
            </div>
            <strong>{a.balance == null ? 'Balance unavailable' : String(a.balance) + ' ' + (a.currency || '')}</strong>
          </div>
        )) : <p>No demo account records loaded.</p>}
      </section>
      {demoAccounts.map((a) => (
        <Portfolio key={a.account_id} accountId={a.account_id} accountType={a.account_type} />
      ))}
      <section className="panel account-panel">
        <h2>MetaTrader 5</h2>
        <span className="status">{mt5?.status || 'Checking'}</span>
        {mt5?.account && (
          <>
            <div className="setting-line"><span>Account</span><strong>{mt5.account.login} - {mt5.account.server}</strong></div>
            <div className="setting-line"><span>Balance</span><strong>{mt5.account.balance} {mt5.account.currency}</strong></div>
            <div className="setting-line"><span>Equity</span><strong>{mt5.account.equity} {mt5.account.currency}</strong></div>
            <div className="setting-line"><span>Free margin</span><strong>{mt5.account.margin_free} {mt5.account.currency}</strong></div>
            <p>Last snapshot: {mt5.observed_at || 'Unavailable'} - {mt5.status === 'stale' ? 'Snapshot stale' : 'Read-only snapshot'}</p>
            <h3>Open positions</h3>
            {mt5.positions?.length ? mt5.positions.map((p) => (
              <div className="setting-line" key={p.ticket}>
                <span>{p.symbol} {p.type.toUpperCase()} - {p.volume} lots</span>
                <strong>{p.profit} {mt5.account.currency}</strong>
              </div>
            )) : <p>No open positions reported.</p>}
          </>
        )}
        <p>Connect through the Windows MT5 terminal and local bridge.</p>
        <button className="outline" onClick={() => setMt5Guide((v) => !v)}>
          {mt5Guide ? 'Hide connection steps' : 'How to connect MT5'}
        </button>
        {mt5Guide && (
          <div className="mt5-guide">
            <p>1. Open MT5 and sign in to your demo account.</p>
            <p>2. Start the read-only local bridge on your Windows computer.</p>
            <p>3. Check the connection status above.</p>
          </div>
        )}
      </section>
    </>
  );

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
          <div className="connection"><span className="dot" /> Deriv authenticated <ShieldCheck size={16} /></div>
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
            <button className="outline" onClick={logout}><LogOut size={16} /> Sign out</button>
          </div>
        </header>
        <main className="content">
          <div className="heading">
            <div>
              {page !== 'Trading Terminal' && <div className="eyebrow">PLAYGO TRADING WORKSPACE</div>}
              <h1>{page}</h1>
              {page === 'Trading Bots' && <span className="demo-only-badge">DEMO ONLY</span>}
              {page !== 'Trading Terminal' && <p>Connected Deriv session</p>}
            </div>
          </div>
          {error && <div role="alert" className="notice">{error}<button onClick={load}>Retry</button></div>}
          {loading && <p role="status">Refreshing accounts...</p>}
          {!loading && page === 'Overview' && <AccountDashboard accounts={accounts} mt5={mt5} navigate={navigate} />}
          {!loading && page === 'Portfolio' && accountsView}
          {!loading && page === 'Trading Terminal' && (
            <>
              <React.Suspense fallback={<p>Loading terminal...</p>}>
                <MarketWorkspace page="Trading Terminal" accounts={accounts} initialSymbol={terminalSymbol} />
              </React.Suspense>
              <details className="panel terminal-ledger" onToggle={(event) => { if (event.currentTarget.open) setLedgerLoaded(true); }}>
                <summary>Paper Simulator (localStorage)</summary>
                {ledgerLoaded && <React.Suspense fallback={<p>Loading ledger...</p>}><PaperTerminal /></React.Suspense>}
              </details>
            </>
          )}
          {!loading && page === 'Trading Bots' && (
            demoAccounts.length
              ? demoAccounts.map((a) => <Strategy key={a.account_id} accountId={a.account_id} accountType={a.account_type} />)
              : <p>A Deriv demo account is required. Real-money strategies are unavailable.</p>
          )}
          {!loading && page === 'Analytics' && <AccountDashboard accounts={accounts} mt5={mt5} navigate={navigate} analytics />}
          {!loading && page === 'Settings' && (
            <>
              <section className="panel">
                <h2>Connections</h2>
                <div className="setting-line"><span>Deriv</span><strong>Authenticated</strong></div>
                <div className="setting-line"><span>MetaTrader 5</span><strong>{mt5?.status || 'Not linked'}</strong></div>
                <div className="setting-line"><span>Real-money execution</span><strong>Unavailable - routes are disabled</strong></div>
              </section>
              <section className="panel account-panel">
                <h2>Session</h2>
                <button className="outline" onClick={load}><RefreshCw size={16} /> Refresh account connection</button>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}