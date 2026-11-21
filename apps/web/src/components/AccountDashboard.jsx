import React,{useEffect,useState} from 'react';
import {Activity,Bot,Wallet,ShieldCheck} from 'lucide-react';
import Metric from './Metric';
const MarketChart=React.lazy(()=>import('./MarketChart'));

const MarketWorkspace=React.lazy(()=>import('./MarketWorkspace'));
export default function AccountDashboard({accounts,mt5,navigate,analytics=false}) {
  const demos=accounts?.filter(a=>a.account_type==='demo')??[];
  const [selected,setSelected]=useState('');
  const account=demos.find(a=>a.account_id===selected)??demos[0];
  const id=account?.account_id;
  const [history,setHistory]=useState(null);
  useEffect(()=>{
    if(!id)return;
    const controller=new AbortController();
    (async()=>{
      try {
        const res=await fetch('/api/demo/history?account='+encodeURIComponent(id),{signal:controller.signal});
        if(!res.ok)throw Error();
        const body=await res.json();
        if(body.accountId!==id || !Array.isArray(body.transactions))throw Error();
        const points=body.transactions.slice().reverse().map(t=>{
          const value=Number(t.sell)-Number(t.buy);
          if(!Number.isFinite(value))throw Error();
          return {time:String(t.id),value:Number(value.toFixed(8))};
        });
        if(!controller.signal.aborted)setHistory({id,points});
      } catch {if(!controller.signal.aborted)setHistory({id,error:true});}
    })();
    return ()=>controller.abort();
  },[id]);
  const result=history?.id===id?history:null;
  const points=result?.points;
  const currency=account?.currency??'';
  return <>
    {demos.length>1 && <label>Demo account <select value={id} onChange={e=>setSelected(e.target.value)}>{demos.map(a=><option key={a.account_id}>{a.account_id}</option>)}</select></label>}
    <div className="metrics">
      <Metric title="Total Portfolio Balance" value={account?.balance==null?'Unavailable':account.balance+' '+currency} change={id?'Selected demo account · '+id:'No demo account'} icon={Wallet}/>
      <Metric title="Total Bot P&L" value="$184.55" change="Simulated strategy results" icon={Activity} positive/>
      <Metric title="Active Trading Bots" value="2 / 3" change="Illustrative bot scenarios" icon={Bot}/>
      <Metric title="Win Rate" value={points?.length?(100*points.filter(t=>t.value>0).length/points.length).toFixed(1)+'%':'—'} change="Recent closed demo trades" icon={ShieldCheck}/>
    </div>
    {!analytics && <React.Suspense fallback={<p>Loading markets…</p>}><MarketWorkspace page="Overview" changePage={navigate}/></React.Suspense>}
    <section className="panel account-panel"><div className="panelhead"><div><h2>Closed trade performance</h2><p>Realized P&L per trade{currency?' · '+currency:''}</p></div></div>
    {points?.length ? <React.Suspense fallback={<p>Loading chart…</p>}><MarketChart data={points}/></React.Suspense> : <p role="status">{!id?'A demo account is required.':result?.error?'Broker history unavailable.':points?'No closed trades reported.':'Loading broker history…'}</p>}
    {analytics && points?.length>0 && <table><thead><tr><th>Transaction</th><th>Realized P&L</th></tr></thead><tbody>{points.slice().reverse().map(t=><tr key={t.time}><td>{t.time}</td><td>{t.value.toFixed(2)} {currency}</td></tr>)}</tbody></table>}
    </section>
    {!analytics && <div className="panelhead"><button className="outline" onClick={()=>navigate('Accounts')}>Manage accounts</button><button className="primary" onClick={()=>navigate('Trading Bots')}>Configure strategy</button></div>}
  </>;
}
