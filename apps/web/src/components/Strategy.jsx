import StrategyReplay from './StrategyReplay';
import React,{useEffect,useState} from 'react';
import {catalog} from '../../server/trading/pack/catalog.js';
import {validPeriods} from '../../server/trading/crossover.js';

export default function Strategy({accountId}) {
  const key='playgo.crossover.v1.'+accountId;
  const [saved,setSaved]=useState(()=>{
    try {
      const config=JSON.parse(localStorage.getItem(key));
      if(validPeriods(config?.fast,config?.slow)) return config;
    } catch {}
    return {fast:5,slow:20};
  });
  const [fast,setFast]=useState(saved.fast),[slow,setSlow]=useState(saved.slow);
  const [output,setOutput]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    const ctrl=new AbortController();
    let timer;
    async function check(){
      try {
        const query=new URLSearchParams({account:accountId,fast:saved.fast,slow:saved.slow});
        const res=await fetch('/api/demo/signal?'+query,{signal:ctrl.signal});
        if(!res.ok) throw Error();
        const body=await res.json();
        const labels={up:'Upward crossover',down:'Downward crossover',none:'No crossover',unavailable:'Recent completed candles unavailable'};
        if(!ctrl.signal.aborted) setOutput((labels[body.signal] || 'Signal unavailable')+(body.closedAt?' · '+new Date(body.closedAt*1000).toLocaleTimeString():''));
      } catch {if(!ctrl.signal.aborted)setOutput('Signal unavailable');}
      if(!ctrl.signal.aborted) timer=setTimeout(check,60000);
    }
    setOutput('Reading candles…');check();
    return ()=>{ctrl.abort();clearTimeout(timer);};
  },[accountId,saved]);
  const [pack,setPack]=useState('moving-average-crossover'),[history,setHistory]=useState([]);
  const [worker,setWorker]=useState(null),[workerMessage,setWorkerMessage]=useState(''),[busy,setBusy]=useState(false);
  async function workerSettings(enabled) {
    setBusy(true);
    try {
      const params=new URLSearchParams({account:accountId});
      const write=typeof enabled==='boolean';
      if(write){
        params.set('pack',pack);params.set('fast',saved.fast);params.set('slow',saved.slow);params.set('enabled',enabled);
      }
      const res=await fetch('/api/demo/strategy?'+params,write?{method:'POST',headers:{'X-PlayGo-Request':'1'}}:{});
      if(!res.ok) throw Error();
      const row=(await res.json()).strategy;
      setWorker(row);
      if(row?.pack_id)setPack(row.pack_id);
      const list=await fetch('/api/demo/strategy?'+new URLSearchParams({account:accountId,view:'history'}));
      if(!list.ok)throw Error();
      setHistory((await list.json()).strategy || []);
      setWorkerMessage(row?'':'No background configuration saved.');
    } catch {setWorkerMessage('Background settings unavailable.');}
    finally {setBusy(false);}
  }
  function save(e){
    e.preventDefault();
    const config={fast:Number(fast),slow:Number(slow)};
    if(!validPeriods(config.fast,config.slow)) return setError('Use whole periods with 2 ≤ fast < slow ≤ 100.');
    try {localStorage.setItem(key,JSON.stringify(config));setSaved(config);setError('');}
    catch {setError('This browser could not save your settings.');}
  }
  return <section className="panel account-panel"><h2>Moving average crossover</h2>
    <p>EUR/USD · 1-minute candles · Demo account {accountId}</p>
    <form onSubmit={save}><label>Fast period <input type="number" min="2" max="99" value={fast} onChange={e=>setFast(e.target.value)}/></label>
    <label> Slow period <input type="number" min="3" max="100" value={slow} onChange={e=>setSlow(e.target.value)}/></label>
    <button className="outline">Save periods</button></form>{error && <p role="alert">{error}</p>}
    <p role="status">{saved.fast}/{saved.slow} · {output}</p><p>Preview updates while this screen is open.</p>
    <h3>Automated paper strategies</h3><p>EUR/USD · 100 simulated units per trade · 1-minute bars. A signal enters at the following bar’s open and settles at its close. Fills exclude spread and fees.</p>
    <label>Worker strategy <select value={pack} onChange={e=>setPack(e.target.value)}>{catalog.map(s=><option key={s.id} value={s.id} disabled={!s.available}>{s.name}{s.available?'':' · Research only'}</option>)}</select></label>
    <StrategyReplay strategy={pack} fast={saved.fast} slow={saved.slow}/>
    <button className="outline" disabled={busy} onClick={()=>workerSettings(true)}>Enable paper strategy ({saved.fast}/{saved.slow})</button>
    <button className="outline" disabled={busy} onClick={()=>workerSettings(false)}>Pause paper strategy</button>
    <button className="outline" disabled={busy} onClick={()=>workerSettings()}>Refresh status and trades</button>
    {worker && <p>Configuration {worker.enabled?'enabled':'paused'} · {worker.fast}/{worker.slow} · Last signal {worker.signal??'pending'} {worker.observed_minute?new Date(worker.observed_minute*1000).toLocaleString():''}</p>}
    {worker && <p>Settled paper trades {worker.paper_trades??0} · Realized paper P&amp;L {worker.paper_pnl??0} USD</p>}
    {history.length>0 && <div className="tablewrap"><table><caption>Recent automated paper trades · EUR/USD</caption><thead><tr>{['Settled','Strategy','Side','Entry','Exit','P/L (USD)'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{history.map(t=><tr key={t.bar_end}><td>{new Date(t.bar_end*1000).toLocaleString()}</td><td>{t.strategy_id}</td><td>{t.direction==='up'?'Buy':'Sell'}</td><td>{t.entry}</td><td>{t.exit}</td><td>{t.pnl}</td></tr>)}</tbody></table></div>}
    <p role="status">{workerMessage}</p></section>;
}
