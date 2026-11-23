import ConfirmDialog from './components/ConfirmDialog';
import React, { useEffect, useState } from 'react';
import {
  Activity, ArrowRight, Bot, LogOut, LayoutDashboard, Link2,
  ChartCandlestick, ChartNoAxesCombined, Settings,
} from 'lucide-react';
import AccountDashboard from './components/AccountDashboard';
import TradeAgent from './components/TradeAgent';

const MarketWorkspace = React.lazy(() => import('./components/MarketWorkspace'));

const NAV = [
  ['Overview', LayoutDashboard, 'Overview'],
  ['Trading Terminal', ChartCandlestick, 'Trade'],
  ['Bot Agents', Bot, 'Bots'],
  ['Analytics', ChartNoAxesCombined, 'Analytics'],
  ['Settings', Settings, 'Settings'],
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
  const [createDemoDialogOpen, setCreateDemoDialogOpen] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [demoAccountError, setDemoAccountError] = useState('');
  const [demoAccountNotice, setDemoAccountNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mt5, setMt5] = useState(null);
  const [page, setPage] = useState('Overview');
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
    setSelectedAccountId(''); setAccounts(null); setDemoAccountError(''); setDemoAccountNotice(''); load();
  }

  if (!session?.authenticated) {
    return (
      <div className="signin">
        <header>
          <div className="brand">
            <span className="brandicon"><Activity size={22} aria-hidden="true" /></span>
            <div><b>PlayGo</b><small>Forex Bot</small></div>
          </div>
        </header>
        <main className="signin-main">
          <h1>Sign in to PlayGo</h1>
          <p>Sign in with Deriv to access your trading accounts.</p>
          {error && <p role="alert" className="signin-error">Sign-in unavailable. <button onClick={load}>Try again</button></p>}
          {loading ? <p role="status">Checking session...</p>
            : session?.configured
              ? <a className="signin-action" href="/api/auth/deriv/start">Continue with Deriv <ArrowRight size={18} aria-hidden="true" /></a>
              : !error && <p role="status" className="signin-error">Deriv sign-in is not configured.</p>}
        </main>
      </div>
    );
  }

  function navigate(next, symbol) {
    if (symbol) setMarketSymbol(symbol);
    setPage(next === 'Accounts' || next === 'Portfolio' ? 'Bot Agents' : next);
  }

  const selectedAccount = accounts?.find(account => account.account_id === selectedAccountId);
  const hasDemoAccount = accounts?.some(account => account.account_type === 'demo') ?? false;
  function selectAccount(accountId) {
    if (accountId === selectedAccountId) return;
    if (selectedAccount) setPendingAccountId(accountId);
    else setSelectedAccountId(accountId);
  }
  const selectedAccounts = selectedAccount ? [selectedAccount] : [];

  async function createDemoAccount() {
    if (creatingDemo) return;
    setCreatingDemo(true);
    setDemoAccountError('');
    try {
      const { res, body } = await fetchJSON('/api/accounts/demo', {
        method: 'POST',
        headers: { 'X-PlayGo-Request': '1' },
      });
      if (!res.ok) {
        const message = body?.error === 'DERIV_ACCOUNT_MANAGE_SCOPE_REQUIRED'
          ? 'Enable account_manage for this Deriv OAuth app, set DERIV_SCOPES to "trade account_manage", then sign out and reconnect.'
          : body?.error || 'Could not create a Deriv demo account.';
        throw new Error(message);
      }
      const demo = body?.account;
      if (!demo || demo.account_type !== 'demo' || typeof demo.account_id !== 'string')
        throw new Error('Deriv returned an invalid demo account.');
      setAccounts(previous => {
        const current = Array.isArray(previous) ? previous : [];
        return current.some(account => account.account_id === demo.account_id)
          ? current
          : [...current, demo];
      });
      if (!selectedAccount) setSelectedAccountId(demo.account_id);
      setDemoAccountNotice('Deriv demo account is ready in the account selector.');
      setCreateDemoDialogOpen(false);
    } catch (requestError) {
      setDemoAccountError(requestError?.message || 'Could not create a Deriv demo account.');
    } finally {
      setCreatingDemo(false);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandicon"><Activity size={22} aria-hidden="true" /></span>
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
            <span className="mobile-brand"><Activity size={18} aria-hidden="true" /> PlayGo</span><span className="workspace-label">Trading workspace</span>
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
            <button type="button" className="outline signout" aria-label="Sign out" onClick={logout}><LogOut size={17} aria-hidden="true" /><span>Sign out</span></button>
          </div>
        </header>
        <main className="content">
          <div className="heading">
            <div>
              <h1>{page}</h1>
            </div>
          </div>
          {error && <div role="alert" className="notice">{error}<button onClick={load}>Retry</button></div>}
          {demoAccountError && <p className="signin-error" role="alert">{demoAccountError}</p>}
          {demoAccountNotice && <p role="status">{demoAccountNotice}</p>}
          {!loading && Array.isArray(accounts) && !hasDemoAccount && (
            <section className="panel demo-account-prompt">
              <div>
                <h2>Deriv demo account</h2>
                <p>No Options demo account was returned by Deriv. Create one to add a virtual-funds account to this selector.</p>
              </div>
              <button type="button" className="outline" onClick={() => { setDemoAccountError(''); setCreateDemoDialogOpen(true); }}>
                Create demo account
              </button>
            </section>
          )}
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
      {pendingAccountId && <ConfirmDialog title="Switch Deriv account" confirmLabel="Switch account"
        onCancel={() => setPendingAccountId('')}
        onConfirm={() => { setSelectedAccountId(pendingAccountId); setPendingAccountId(''); }}>
        <p>Bot Agents will pause monitoring the current account until you select it again.</p>
      </ConfirmDialog>}
      {createDemoDialogOpen && <ConfirmDialog title="Create a Deriv demo account"
        confirmLabel={creatingDemo ? 'Creating...' : 'Create demo account'}
        confirmDisabled={creatingDemo}
        onCancel={() => setCreateDemoDialogOpen(false)}
        onConfirm={() => void createDemoAccount()}>
        <p>This creates a demo Options account using virtual funds only. Deriv may require the account_manage scope on this OAuth app.</p>
        {demoAccountError && <p className="signin-error" role="alert">{demoAccountError}</p>}
      </ConfirmDialog>}
    </div>
  );
}