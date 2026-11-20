import React,{useEffect,useState} from 'react';
import {Activity,LogOut,RefreshCw,ShieldCheck} from 'lucide-react';
const DemoApp=React.lazy(()=>import('./demo/DemoApp'));
export default function App(){
 const [session,setSession]=useState(null),[accounts,setAccounts]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [demo,setDemo]=useState(false);
 async function load(){
  setLoading(true);setError('');setAccounts(null);
  try {
   const r=await fetch('/api/session');if(!r.ok)throw Error('Account service unavailable. Start the backend.');
   const s=await r.json();setSession(s);
   if(s.authenticated){const a=await fetch('/api/accounts');const body=await a.json();if(!a.ok){if(a.status===401)setSession({...s,authenticated:false});throw Error(body.error||'Could not load accounts');}setAccounts(body.accounts);}
  }catch(e){setError(e.message);}finally{setLoading(false);}
 }
 useEffect(()=>{load();},[]);
 async function logout(){await fetch('/api/auth/logout',{method:'POST',headers:{'X-PlayGo-Request':'1'}});setAccounts(null);load();}
 if(demo)return <><div className="preview-banner">DESIGN PREVIEW · All figures and bot results are simulated <button onClick={()=>setDemo(false)}>Return to accounts</button></div><React.Suspense fallback={<p>Loading preview…</p>}><DemoApp/></React.Suspense></>;
 if(!session?.authenticated) return (
  <div className="signin">
   <header><div className="brand"><span className="brandicon"><Activity size={21}/></span><div><b>PLAYGO</b><small>TRADING TERMINAL</small></div></div></header>
   <main className="signin-main">
    <h1>Sign in to PlayGo</h1>
    <p>Use your Deriv account to access your trading workspace.</p>
    {error && <p role="alert" className="signin-error">Sign-in service unavailable. <button onClick={load}>Try again</button></p>}
    {!error && new URLSearchParams(location.search).has('auth_error') && <p role="alert" className="signin-error">Deriv sign-in failed. Please try again.</p>}
    {loading ? <p role="status">Checking your session…</p> : session?.configured
      ? <a className="signin-action" href="/api/auth/deriv/start">Continue with Deriv <span aria-hidden="true">→</span></a>
      : !error && <p role="status" className="signin-error">Deriv sign-in is unavailable until the server is configured.</p>}
    <button className="signin-demo" onClick={()=>setDemo(true)}>Open demo workspace</button>
   </main>
  </div>
 );
 return <div className="account-shell"><header className="account-header"><div className="brand"><span className="brandicon"><Activity/></span><div><b>PLAYGO</b><small>TRADING TERMINAL</small></div></div>{session?.authenticated&&<button className="outline" onClick={logout}><LogOut size={16}/> Sign out</button>}</header>
 <main className="account-content"><h1>Accounts</h1> {error&&<div role="alert" className="notice">{error}<button onClick={load}>Retry</button></div>}
 {new URLSearchParams(location.search).has('auth_error')&&<div role="alert" className="notice">Deriv sign-in could not be completed. Check the registered callback URL and try again.</div>}
{loading?<p role="status">Refreshing accounts…</p>:<><section className="panel account-panel"><div className="panelhead"><div><h2>Deriv accounts</h2><p>Accounts returned by Deriv · execution unavailable in this build</p></div><button className="outline" onClick={load}><RefreshCw size={16}/> Refresh</button></div>{accounts?.length?accounts.map(a=><div className="setting-line" key={a.account_id}><div><b>{a.account_id}</b><p>{a.account_type||'Type unavailable'} · {a.currency||'Currency unavailable'}</p></div><strong>{a.balance==null?'Balance unavailable':String(a.balance)+' '+(a.currency||'')}</strong></div>):<p>No account records loaded.</p>}</section>
 <section className="panel account-panel"><h2>MetaTrader 5</h2><span className="status">Not linked</span><p>MT5 requires its own account number, broker server, and a Windows terminal bridge. Signing in with Deriv does not authorize access to an MT5 terminal.</p><p className="muted">The isolated bridge scaffold is included under services/mt5. No MT5 account is connected.</p></section></>}
 <div className="account-foot"><ShieldCheck size={18}/> Account connections are separate from order execution. Live trading is not implemented.</div></main></div>;
}
