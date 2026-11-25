import ConfirmDialog from './components/ConfirmDialog';
import React, { useEffect, useState } from 'react';
import {
  ArrowRight, Bot, LogOut, LayoutDashboard, Link2,
  ChartCandlestick, ChartNoAxesCombined, Settings,
} from 'lucide-react';
import AccountDashboard from './components/AccountDashboard';
import { TradeAgent } from './agents/index.js';

const MarketWorkspace = React.lazy(() => import('./components/MarketWorkspace'));

const NAV = [
  ['Overview', LayoutDashboard, 'Overview'],
  ['Trading Terminal', ChartCandlestick, 'Trade'],
  ['Bot Agents', Bot, 'Bots'],
  ['Analytics', ChartNoAxesCombined, 'Analytics'],
  ['Settings', Settings, 'Settings'],
];

const eatClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Dar_es_Salaam', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <time className="header-clock" dateTime={now.toISOString()}>{eatClock.format(now)} EAT</time>;
}

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
  const [pendingAccountRef, setPendingAccountRef] = useState('');
  const [selectedAccountRef, setSelectedAccountRef] = useState('');
  const [accountSelectionBusy, setAccountSelectionBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mt5, setMt5] = useState(null);
  const [page, setPage] = useState('Overview');
  const [plannedDuration, setPlannedDuration] = useState();
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
        const linked = Array.isArray(aBody?.accounts) ? aBody.accounts : [];
        setAccounts(linked);
        setSelectedAccountRef(linked.some(row => row.accountRef === aBody.activeAccountRef)
          ? aBody.activeAccountRef
          : '');
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

  useEffect(() => {
    if (!session?.authenticated || !selectedAccountRef) return;
    const controller = new AbortController();
    let checking = false;
    let pending = false;
    async function refreshBalances() {
      if (controller.signal.aborted) return;
      if (checking) { pending = true; return; }
      checking = true;
      try {
        const { res, body } = await fetchJSON('/api/accounts', { signal: controller.signal });
        if (!res.ok || !Array.isArray(body?.accounts) || controller.signal.aborted) return;
        const balances = new Map(body.accounts.map(row => [row.accountRef, row.balance]));
        setAccounts(previous => previous?.map(row =>
          balances.has(row.accountRef) && balances.get(row.accountRef) !== row.balance
            ? { ...row, balance: balances.get(row.accountRef) }
            : row));
      } catch {
        // Preserve the last verified balance while the broker is unavailable.
      } finally {
        checking = false;
        if (pending) { pending = false; void refreshBalances(); }
      }
    }
    const timer = setInterval(refreshBalances, 15_000);
    function onSettlement(event) {
      if (event.detail === selectedAccountRef) void refreshBalances();
    }
    window.addEventListener('playgo:settlement', onSettlement);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('playgo:settlement', onSettlement);
    };
  }, [session?.authenticated, selectedAccountRef]);

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-PlayGo-Request': '1' } }); } catch {}
    setSelectedAccountRef(''); setAccounts(null); load();
  }

  if (!session?.authenticated) {
    return (
      <div className="signin">
        <header>
          <div className="brand">
            <span className="brandicon"><ChartCandlestick size={22} aria-hidden="true" /></span>
            <div><b>PlayGo</b><small>Forex Bot</small></div>
          </div>
        </header>
        <main className="signin-main">
          <span className="signin-monogram" aria-hidden="true"><ChartCandlestick size={30} /></span>
          <h1>Sign in to PlayGo</h1>
          <p>Access your trading workspace with your Deriv account.</p>
          {error && <p role="alert" className="signin-error">Sign-in unavailable. <button onClick={load}>Try again</button></p>}
          {loading ? <p role="status">Checking session...</p>
            : session?.configured
              ? <a className="signin-action" href="/api/auth/deriv/start">Continue with Deriv <ArrowRight size={18} aria-hidden="true" /></a>
              : !error && <p role="status" className="signin-error">Deriv sign-in is not configured.</p>}
        </main>
      </div>
    );
  }

  function navigate(next, symbol, duration) {
    setPlannedDuration(duration);
    if (symbol) setMarketSymbol(symbol);
    setPage(next === 'Accounts' || next === 'Portfolio' ? 'Bot Agents' : next);
  }

  const selectedAccount = accounts?.find(account => account.accountRef === selectedAccountRef);
  const pendingAccount = accounts?.find(account => account.accountRef === pendingAccountRef);
  function selectAccount(accountRef) {
    if (accountRef === selectedAccountRef) return;
    setPendingAccountRef(accountRef);
    setError('');
  }
  async function confirmAccountSelection() {
    if (!pendingAccount || accountSelectionBusy) return;
    setAccountSelectionBusy(true);
    try {
      const query = new URLSearchParams({ accountRef: pendingAccount.accountRef });
      if (pendingAccount.account_type === 'real') query.set('confirmReal', '1');
      const { res, body } = await fetchJSON('/api/accounts/select?' + query, {
        method: 'POST',
        headers: { 'X-PlayGo-Request': '1' },
      });
      if (!res.ok) {
        const messages = {
          ACCOUNT_SWITCH_OPEN_POSITIONS: 'Close or wait for all open positions before switching accounts.',
          ACTIVE_ACCOUNT_STATUS_UNAVAILABLE: 'Could not verify the current account positions. No account switch was made.',
          ACTIVE_ACCOUNT_UNAVAILABLE: 'The current account is no longer available to verify. Sign out and reconnect before switching.',
          REAL_ACCOUNT_CONFIRMATION_REQUIRED: 'Confirm the real-account selection to continue.',
          ACCOUNT_REFERENCE_NOT_FOUND: 'That account is no longer available. Refresh the account list.',
        };
        throw new Error(messages[body?.error] || body?.error || 'Account selection failed.');
      }
      setSelectedAccountRef(body.activeAccount?.accountRef || pendingAccount.accountRef);
      setPendingAccountRef('');
      setError('');
    } catch (selectionError) {
      setError(selectionError?.message || 'Account selection failed.');
    } finally {
      setAccountSelectionBusy(false);
    }
  }
  const selectedAccounts = selectedAccount ? [selectedAccount] : [];

  return (
    <div className="app">
      <a className="skip-nav" href="#workspace">Skip to workspace</a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brandicon"><ChartCandlestick size={22} aria-hidden="true" /></span>
          <div><b>PlayGo</b><small>Forex Bot</small></div>
        </div>
        <nav aria-label="Main navigation">
          {NAV.map(([name, Icon]) => (
            <button key={name} className={page === name ? 'selected' : ''} aria-current={page === name ? 'page' : undefined} onClick={() => navigate(name)}>
              <Icon size={19} aria-hidden="true" />{name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection"><span className="dot" /> Deriv connected</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="top-left">
            <span className="mobile-brand"><ChartCandlestick size={18} aria-hidden="true" /> PlayGo</span><span className="workspace-label">PlayGo <span aria-hidden="true">/</span> {page}</span>
          </div>
                    <div className="top-right">
            <HeaderClock />
            {!!accounts?.length && (
              <select className="outline" aria-label="Deriv trading account" value={selectedAccount?.accountRef || ''}
                onChange={event => selectAccount(event.target.value)}>
                <option value="" disabled>Select Deriv account</option>
                {accounts.map(account => (
                  <option key={account.accountRef} value={account.accountRef}>
                    {account.account_type === 'demo' ? 'Demo' : 'Real'} · {account.maskedAccountId}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="outline signout" aria-label="Sign out" onClick={logout}><LogOut size={17} aria-hidden="true" /><span>Sign out</span></button>
          </div>

        </header>
        <main className="content" id="workspace" tabIndex={-1}>
          <div className="heading">
            <div>
              <h1>{page}</h1>
            </div>
          </div>
          {error && <div role="alert" className="notice">{error}<button onClick={load}>Retry</button></div>}
          {loading && <p role="status">Loading...</p>}
          {!loading && page === 'Overview' && <AccountDashboard accounts={selectedAccounts} mt5={mt5} navigate={navigate} marketSymbol={marketSymbol} onMarketChange={setMarketSymbol} />}
          {!loading && page === 'Bot Agents' && <TradeAgent key={selectedAccountRef} account={selectedAccount} marketSymbol={marketSymbol} onMarketChange={setMarketSymbol} realExecutionEnabled={session.execution === true} />}
          {!loading && page === 'Trading Terminal' && (
            <React.Suspense fallback={<p>Loading...</p>}>
              <MarketWorkspace page="Trading Terminal" initialDuration={plannedDuration} marketSymbol={marketSymbol} onMarketChange={setMarketSymbol} account={selectedAccount} executionEnabled={session.execution === true} changePage={navigate} />
            </React.Suspense>
          )}
          {!loading && page === 'Analytics' && <AccountDashboard accounts={selectedAccounts} mt5={mt5} navigate={navigate} analytics />}
          {!loading && page === 'Settings' && (
            <section className="panel settings-panel">
              <div className="panelhead"><h2><Link2 size={17} aria-hidden="true" /> Connections</h2></div>
              <div className="setting-line"><span>Deriv</span><strong>Connected</strong></div>
              <div className="setting-line"><span>MetaTrader 5</span><strong>{mt5?.status || 'Not linked'}</strong></div>
              <div className="setting-line"><span>Accounts</span><strong>{accounts?.length ?? 0} connected</strong></div>
            </section>
          )}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV.map(([name, Icon, shortLabel]) => (
          <button type="button" key={name} aria-label={name} aria-current={page === name ? 'page' : undefined}
            onClick={() => navigate(name)}>
            <Icon size={20} aria-hidden="true" /><span>{shortLabel}</span>
          </button>
        ))}
      </nav>
      {pendingAccount && <ConfirmDialog title={pendingAccount.account_type === 'real' ? 'Confirm real account' : 'Switch Deriv account'}
        confirmLabel={accountSelectionBusy ? 'Checking...' : pendingAccount.account_type === 'real' ? 'Confirm real account' : 'Switch account'}
        onCancel={() => setPendingAccountRef('')}
        onConfirm={() => { void confirmAccountSelection(); }}>
        <p>Use {pendingAccount.account_type === 'demo' ? 'Demo' : 'Real'} account {pendingAccount.maskedAccountId} ({pendingAccount.currency}).</p>
        {pendingAccount.account_type === 'real' && <p>This selects a real-money account. Real trading still requires the server live-trading switch and risk checks.</p>}
        <p>Account switching is blocked while the currently selected account has open positions.</p>
      </ConfirmDialog>}
    </div>
  );
}