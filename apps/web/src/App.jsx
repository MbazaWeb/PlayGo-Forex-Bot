import React,{useEffect,useState} from 'react';
import {Activity,LogOut,RefreshCw,ShieldCheck,LayoutDashboard,Wallet,ChartCandlestick,Bot,ChartNoAxesCombined,Settings,Menu,X} from 'lucide-react';
const PaperTerminal=React.lazy(()=>import('./PaperTerminal'));
const DemoApp=React.lazy(()=>import('./demo/DemoApp'));
export default function App(){
 const [session,setSession]=useState(null),[accounts,setAccounts]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [demo,setDemo]=useState(false),[page,setPage]=useState('Overview'),[mobile,setMobile]=useState(false);
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
 const nav=[['Overview',LayoutDashboard],['Accounts',Wallet],['Trading Terminal',ChartCandlestick],['Trading Bots',Bot],['Analytics',ChartNoAxesCombined],['Settings',Settings]];
 const navigate=(next)=>{setPage(next);setMobile(false);};
 const accountsView=<><section className="panel account-panel"><div className="panelhead"><div><h2>Deriv accounts</h2><p>Accounts returned by Deriv · execution unavailable in this build</p></div><button className="outline" onClick={load}><RefreshCw size={16}/> Refresh</button></div>{accounts?.length?accounts.map(a=><div className="setting-line" key={a.account_id}><div><b>{a.account_id}</b><p>{a.account_type||'Type unavailable'} · {a.currency||'Currency unavailable'}</p></div><strong>{a.balance==null?'Balance unavailable':String(a.balance)+' '+(a.currency||'')}</strong></div>):<p>No account records loaded.</p>}</section><section className="panel account-panel"><h2>MetaTrader 5</h2><span className="status">Not linked</span><p>MT5 requires a Windows terminal bridge. Deriv login does not authorize MT5 access.</p></section></>;
 return <div className="app">
 <aside className={'sidebar '+(mobile?'show':'')}><div className="brand"><span className="brandicon"><Activity size={22}/></span><div><b>PLAYGO</b><small>TRADING TERMINAL</small></div><button className="mobile-close" onClick={()=>setMobile(false)} aria-label="Close menu"><X size={20}/></button></div><p className="nav-label">WORKSPACE</p><nav aria-label="Main navigation">{nav.map(([name,Icon])=><button key={name} className={page===name?'selected':''} aria-current={page===name?'page':undefined} onClick={()=>navigate(name)}><Icon size={19}/>{name}</button>)}</nav><div className="sidebar-bottom"><div className="connection"><span className="dot"/> Deriv authenticated <ShieldCheck size={16}/></div><div className="help"><b>Execution disabled</b><p>Paper trading uses manual prices. No live broker orders are sent.</p></div></div></aside>
 {mobile&&<button className="account-menu-backdrop" aria-label="Close navigation" onClick={()=>setMobile(false)}/>}
 <div className="main"><header className="topbar"><div className="top-left"><button className="hamburger" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={23}/></button><span className="breadcrumb">Workspace</span><span className="slash">/</span><b>{page}</b></div><div className="top-right"><span className="demo-tag">LIVE EXECUTION OFF</span><button className="outline" onClick={logout}><LogOut size={16}/> Sign out</button></div></header>
 <main className="content"><div className="heading"><div><div className="eyebrow">PLAYGO TRADING WORKSPACE</div><h1>{page}</h1><p>Connected Deriv session · broker execution is disabled</p></div></div>
 {error&&<div role="alert" className="notice">{error}<button onClick={load}>Retry</button></div>}
 {loading&&<p role="status">Refreshing accounts…</p>}
 {!loading&&page==='Overview'&&<><section className="panel"><h2>Welcome to PlayGo</h2><p>Your Deriv session is authenticated. Account information is available below; MT5 and automated execution are not connected.</p></section>{accountsView}</>}
 {!loading&&page==='Accounts'&&accountsView}
 {!loading&&page==='Trading Terminal'&&<React.Suspense fallback={<p>Loading paper terminal…</p>}><PaperTerminal/></React.Suspense>}
 {!loading&&page==='Trading Bots'&&<section className="panel"><h2>Trading bots</h2><p>Automated strategies and broker execution are not implemented in this deployment. No bots are running.</p><button className="outline" onClick={()=>setDemo(true)}>Explore simulated bot designs</button></section>}
 {!loading&&page==='Analytics'&&<section className="panel"><h2>Trading analytics</h2><p>Real performance analytics are not available until trade history is synchronized. Paper trading history is stored only in this browser.</p><button className="outline" onClick={()=>navigate('Trading Terminal')}>View paper trades</button></section>}
 {!loading&&page==='Settings'&&<><section className="panel"><h2>Connections</h2><div className="setting-line"><span>Deriv</span><strong>Authenticated</strong></div><div className="setting-line"><span>MetaTrader 5</span><strong>Not linked</strong></div><div className="setting-line"><span>Live trading</span><strong>Disabled</strong></div></section><section className="panel account-panel"><h2>Session</h2><button className="outline" onClick={load}><RefreshCw size={16}/> Refresh account connection</button></section></>}
 <div className="account-foot"><ShieldCheck size={18}/> Live trading and automated execution are not implemented.</div>
 </main></div></div>;
}
