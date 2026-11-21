import React,{useEffect,useState,useRef} from 'react';
import {SlidersHorizontal,Sparkles} from 'lucide-react';
import StrategyReplay from './StrategyReplay';
import {catalog} from '../../server/trading/pack/catalog.js';
import {AUTOMATIC,AUTO_PERIODS} from '../../server/trading/pack/automatic.js';
import {validPeriods} from '../../server/trading/crossover.js';

const rules=catalog.filter(s=>s.available);
const name=id=>catalog.find(s=>s.id===id)?.name || (id===AUTOMATIC?'Automatic selection':'—');
async function api(path,options){
  const response=await fetch(path,options);
  if(!response.ok)throw Error();
  return response.json();
}

export default function Strategy({accountId}){
  const base='/api/demo/strategy?'+new URLSearchParams({account:accountId});
  const [mode,setMode]=useState(AUTOMATIC),[pack,setPack]=useState('moving-average-crossover');
  const [fast,setFast]=useState(5),[slow,setSlow]=useState(20);
  const [worker,setWorker]=useState(null),[loaded,setLoaded]=useState(false);
  const [history,setHistory]=useState(null),[ops,setOps]=useState(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
  const hydrated=useRef(false);
  useEffect(()=>{
    const ctrl=new AbortController(),opt={signal:ctrl.signal};
    async function load(){
      const [config,trades,operations]=await Promise.allSettled([
        api(base,opt),api(base+'&view=history',opt),api('/api/demo/operations?'+new URLSearchParams({account:accountId}),opt)]);
      if(ctrl.signal.aborted)return;
      if(config.status==='fulfilled'){
        const row=config.value.strategy;
        setWorker(row);setLoaded(true);
        if(!hydrated.current && row){
          setMode(row.pack_id===AUTOMATIC?AUTOMATIC:'manual');setPack(row.pack_id && row.pack_id!==AUTOMATIC?row.pack_id:'moving-average-crossover');
          setFast(row.fast);setSlow(row.slow);
        }
        hydrated.current=true;
      }else {setLoaded(false);setWorker(null);}
      setHistory(trades.status==='fulfilled'?trades.value.strategy:null);
      setOps(operations.status==='fulfilled'?operations.value:null);
    }
    load();return ()=>ctrl.abort();
  },[accountId,base,refresh]);
  const auto=mode===AUTOMATIC;
  const periods=auto?AUTO_PERIODS:{fast:Number(fast),slow:Number(slow)};
  const valid=validPeriods(periods.fast,periods.slow);
  async function save(enabled){
    setBusy(true);setNotice('');
    const form=enabled?{pack:auto?AUTOMATIC:pack,...periods}:{pack:worker.pack_id||'',fast:worker.fast,slow:worker.slow};
    try{
      const body=await api(base+'&'+new URLSearchParams({...form,enabled}),{method:'POST',headers:{'X-PlayGo-Request':'1'}});
      setWorker(body.strategy);setNotice(enabled?'Setup saved. The worker will use it on its next pass.':'Bot paused.');
      setRefresh(n=>n+1);
    }catch{setNotice('Could not confirm the change. Refresh status before retrying.');}
    finally{setBusy(false);}
  }
  const latest=ops?.intents?.find(x=>x.status==='confirmed'||x.status==='settled');
  return <section className="panel bot-setup">
    <div className="panelhead"><div><h2>Bot setup</h2><p>EUR/USD · 1-minute candles · Demo {accountId}</p></div>
      <span className="bot-state">{!loaded?'Status unavailable':worker?.enabled?'Setup enabled':worker?'Paused':'New bot'}</span></div>
    <fieldset className="mode-field"><legend>Who selects the strategy?</legend><div className="mode-options">
      {[[AUTOMATIC,Sparkles,'System automation','PlayGo selects a rule from the latest completed candles.'],['manual',SlidersHorizontal,'Manual setup','Choose the rule and periods the worker will run.']].map(([value,Icon,title,detail])=>
        <label className={'mode-option '+(mode===value?'chosen':'')} key={value}><input type="radio" name={'mode-'+accountId} checked={mode===value} onChange={()=>setMode(value)}/>
          <Icon size={21}/><strong>{title}</strong><small>{detail}</small></label>)}</div></fieldset>
    {auto?<p className="mode-detail">Directional movement selects RSI Momentum. Choppy movement selects Bollinger Bands Reversion. Flat prices produce no trade signal.</p>:
      <div className="market-controls"><label>Strategy<select value={pack} onChange={e=>setPack(e.target.value)}>{rules.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Fast period<input type="number" min="2" max="99" value={fast} onChange={e=>setFast(e.target.value)}/></label>
        <label>Slow period<input type="number" min="3" max="100" value={slow} onChange={e=>setSlow(e.target.value)}/></label></div>}
    {!valid&&<p role="alert">Use whole periods from 2 to 100. The slow period must exceed the fast period.</p>}
    <div className="bot-actions"><button className="primary" disabled={busy||!loaded||!valid} onClick={()=>save(true)}>{worker?.enabled?'Apply setup':'Enable bot'}</button>
      <button className="outline" disabled={busy||!loaded||!worker?.enabled} onClick={()=>save(false)}>Pause bot</button>
      <button className="textlink" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh status</button></div>
    <p role="status">{notice}</p>
    <div className="bot-status"><div><small>Last worker signal</small><strong>{worker?.signal||'Awaiting signal'}</strong><small>{worker?.observed_minute?new Date(worker.observed_minute*1000).toLocaleString():'No observation recorded'}</small></div>
      <div><small>Last evaluated rule</small><strong>{name(worker?.selected_rule)}</strong></div>
      <div><small>Demo broker execution</small><strong>{!ops?'Unverified':ops.status?.qualified&&!ops.status?.paused?'Account armed':'Off'}</strong><small>{latest?'Latest confirmed activity · '+new Date(latest.updated_at).toLocaleString():'No confirmed order shown'}</small></div></div>
    <details><summary>Historical replay</summary><p>Simulates 100 units per fill on EUR/USD. Spread and fees are excluded.</p>{valid&&<StrategyReplay strategy={auto?AUTOMATIC:pack} {...periods}/>}</details>
    <details><summary>Paper trade history{worker?' · '+worker.paper_trades+' trades':''}</summary><p>Realized paper P&amp;L · {worker?.paper_pnl??'—'} USD</p>
      {history?.length?<div className="tablewrap"><table><thead><tr>{['Settled','Strategy','Side','Entry','Exit','P/L (USD)'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{history.map(t=><tr key={t.bar_end}><td>{new Date(t.bar_end*1000).toLocaleString()}</td><td>{name(t.strategy_id)}</td><td>{t.direction==='up'?'Buy':'Sell'}</td><td>{t.entry}</td><td>{t.exit}</td><td>{t.pnl}</td></tr>)}</tbody></table></div>:<p>{history?'No settled paper trades.':'History unavailable.'}</p>}</details>
  </section>;
}
