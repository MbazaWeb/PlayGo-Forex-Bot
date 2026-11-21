import React,{useEffect,useState} from 'react';
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
  const [worker,setWorker]=useState(null),[workerMessage,setWorkerMessage]=useState(''),[busy,setBusy]=useState(false);
  async function workerSettings(enabled) {
    setBusy(true);
    try {
      const params=new URLSearchParams({account:accountId});
      const write=typeof enabled==='boolean';
      if(write){
        params.set('fast',saved.fast);params.set('slow',saved.slow);params.set('enabled',enabled);
      }
      const res=await fetch('/api/demo/strategy?'+params,write?{method:'POST',headers:{'X-PlayGo-Request':'1'}}:{});
      if(!res.ok) throw Error();
      const row=(await res.json()).strategy;
      setWorker(row);setWorkerMessage(row?'':'No background configuration saved.');
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
    <h3>Background signals</h3><p>The server worker uses the periods saved below. Order submission is disabled.</p>
    <button className="outline" disabled={busy} onClick={()=>workerSettings(true)}>Enable {saved.fast}/{saved.slow} on worker</button>
    <button className="outline" disabled={busy} onClick={()=>workerSettings(false)}>Pause worker signals</button>
    <button className="outline" disabled={busy} onClick={()=>workerSettings()}>Read worker status</button>
    {worker && <p>Configuration {worker.enabled?'enabled':'paused'} · {worker.fast}/{worker.slow} · Last signal {worker.signal??'pending'} {worker.observed_minute?new Date(worker.observed_minute*1000).toLocaleString():''}</p>}
    <p role="status">{workerMessage}</p></section>;
}
