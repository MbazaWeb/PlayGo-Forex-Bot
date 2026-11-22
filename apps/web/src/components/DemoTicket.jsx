import React,{useEffect,useRef,useState} from 'react';

export default function DemoTicket({accounts,catalog}){
  const demos=(accounts||[]).filter(a=>a.account_type==='demo');
  const [selected,select]=useState(''),[direction,setDirection]=useState('CALL');
  const [stake,setStake]=useState('1'),[minutes,setMinutes]=useState('15');
  const [gate,setGate]=useState(null),[result,setResult]=useState(''),[sent,setSent]=useState(false);
  const [busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const lock=useRef(false);
  const account=demos.find(a=>a.account_id===selected)||demos[0];
  const id=account?.account_id;
  useEffect(()=>{
    const ctrl=new AbortController();
    setGate(null);
    if(id){
      fetch('/api/demo/ticket?'+new URLSearchParams({account:id}),{signal:ctrl.signal})
        .then(async r=>{const body=await r.json();if(!ctrl.signal.aborted)setGate({id,ready:r.ok&&body.ready===true,message:body.message||'Demo status unavailable.'});})
        .catch(()=>{if(!ctrl.signal.aborted)setGate({id,ready:false,message:'Demo status unavailable.'});});
    }
    return ()=>ctrl.abort();
  },[id,refresh]);
  const ready=gate?.id===id && gate?.ready;
  const readinessMessage=!id?'Connect a Deriv demo account to place orders.':
    gate?.id===id?gate.message:'Checking demo execution…';
  const blockedReason=!ready?readinessMessage:!catalog.market?'Select a market in the chart.':
    !(Number(stake)>0&&Number(stake)<=1)?'Enter a stake greater than 0 and up to 1.':'';
  async function submit(){
    if(lock.current||sent)return;
    if(blockedReason){
      setResult('Order not sent. '+blockedReason);
      return;
    }
    lock.current=true;setBusy(true);setSent(true);setResult('');
    try{
      const query=new URLSearchParams({account:id,symbol:catalog.market.symbol,direction,stake,minutes,key:crypto.randomUUID()});
      const r=await fetch('/api/demo/ticket?'+query,{method:'POST',headers:{'X-PlayGo-Request':'1'}});
      const body=await r.json();
      setResult(body.message || (r.status===401
        ? 'Your session expired. Sign in again.'
        : 'Order status unavailable. Check Portfolio before trying again.'));
    }catch{setResult('Acknowledgment unavailable. Check Portfolio for the order status.');}
    finally{setBusy(false);setGate(null);setRefresh(n=>n+1);lock.current=false;}
  }
  return <section className="panel order-panel"><h2>Demo order ticket</h2>
    {demos.length>1?<label>Demo account<select disabled={busy} value={id||''} onChange={e=>{select(e.target.value);setResult('');setSent(false);}}>{demos.map(a=><option key={a.account_id}>{a.account_id}</option>)}</select></label>:id&&<p className="terminal-ticket-account">Account {id}</p>}
    <div className="trade-toggle">{[['CALL','Rise'],['PUT','Fall']].map(([value,label])=><button disabled={busy} key={value} aria-pressed={direction===value} className={direction===value?(value==='CALL'?'buy':'sell'):''} onClick={()=>setDirection(value)}>{label}</button>)}</div>
    <p className="terminal-ticket-market">{catalog.market?.name || 'Select a market in the chart'}</p>
    <div className="terminal-order-fields">
    <label>Stake ({account?.currency||'account currency'})<input disabled={busy} type="number" min="0.01" max="1" step="0.01" value={stake} onChange={e=>setStake(e.target.value)}/></label>
    <label>Duration<select disabled={busy} value={minutes} onChange={e=>setMinutes(e.target.value)}>{[1,5,15,30,60].map(n=><option key={n} value={n}>{n} min</option>)}</select></label>
    </div>

    {(!sent||busy)?<button className={blockedReason&&!busy?'outline wide':'primary wide'} disabled={busy} onClick={submit}>
      {busy?'Submitting demo order…':direction==='CALL'?'Place demo Rise order':'Place demo Fall order'}
    </button>:
      <button className="outline" disabled={busy||!ready} onClick={()=>{setResult('');setSent(false);}}>Prepare another order</button>}
    {id&&!ready&&gate&&<button className="textlink" disabled={busy} onClick={()=>{if(!sent)setResult('');setGate(null);setRefresh(n=>n+1);}}>Retry status check</button>}
    <p role="status">{busy?'Waiting for the order response…':result||blockedReason}</p>
  </section>;
}
