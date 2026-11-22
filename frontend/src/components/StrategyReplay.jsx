import React,{useEffect,useState} from 'react';
import {publicRequest,readCandles} from './derivMarkets';
import {packSignal} from '../../../backend/trading/pack/signal.js';

export default function StrategyReplay({strategy,fast,slow}) {
  const [run,setRun]=useState(0),[result,setResult]=useState('');
  useEffect(()=>{
    setResult('');
    if(!run)return;
    const ctrl=new AbortController();
    const end=Math.floor(Date.now()/60000)*60-1;
    setResult('Loading EUR/USD history…');
    async function replay(){
      const response=await publicRequest({ticks_history:'frxEURUSD',style:'candles',granularity:60,count:400,end:String(end),adjust_start_time:1},ctrl.signal);
      const rows=readCandles(response).filter(r=>r.epoch+60<=end+1);
      const windowSize=Math.max(slow*2,40)+5;
      let trades=0,pnl=0,eligible=0;
      const daily=new Map();
      for(let i=windowSize;i<rows.length;i++){
        const next=rows[i],previous=rows[i-1];
        if(next.epoch!==previous.epoch+60)continue;
        const {signal}=packSignal(rows.slice(i-windowSize,i),{pack_id:strategy,fast,slow},next.epoch);
        if(signal==='unavailable')continue;
        eligible++;
        const day=Math.floor((next.epoch+60)/86400);
        if(!['up','down'].includes(signal)||(daily.get(day)||0)<=-200 || next.open>10 || next.close>10)continue;
        const gain=(signal==='up'?1:-1)*(next.close-next.open)*100;
        trades++;pnl+=gain;daily.set(day,(daily.get(day)||0)+gain);
      }
      if(!ctrl.signal.aborted)setResult(eligible ? eligible+' eligible bars · '+trades+' simulated fills · '+pnl.toFixed(2)+' USD · through '+rows.at(-1).time+' UTC':'Insufficient consecutive closed candles for replay.');
    }
    replay().catch(()=>{if(!ctrl.signal.aborted)setResult('Historical candles unavailable. Retry the replay.');});
    return ()=>ctrl.abort();
  },[run,strategy,fast,slow]);
  return <div><button className="outline" onClick={()=>setRun(n=>n+1)}>Replay strategy on recent candles</button><p role="status">{result}</p></div>;
}
