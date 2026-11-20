import React,{useEffect,useMemo,useState} from 'react';
const KEY='playgo.paper.v1';
const PAIRS=['EUR/USD','GBP/USD','USD/JPY','XAU/USD'];
const initial={cash:10000,positions:[],history:[]};
function read(){try{const v=JSON.parse(localStorage.getItem(KEY));return v&&Array.isArray(v.positions)&&Array.isArray(v.history)&&Number.isFinite(v.cash)?v:initial;}catch{return initial;}}
const fmt=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function PaperTerminal(){
 const [ledger,setLedger]=useState(read),[pair,setPair]=useState(PAIRS[0]),[price,setPrice]=useState('1.1000'),[units,setUnits]=useState('100'),[side,setSide]=useState('buy'),[message,setMessage]=useState('');
 useEffect(()=>{localStorage.setItem(KEY,JSON.stringify(ledger));},[ledger]);
 const p=Number(price),q=Number(units),valid=Number.isFinite(p)&&p>0&&Number.isSafeInteger(q)&&q>0;
 const exposure=ledger.positions.reduce((n,x)=>n+x.units*x.entry,0);
 const equity=ledger.cash+ledger.positions.reduce((n,x)=>n+x.units*(x.side==='buy'?(valid&&x.pair===pair?p:x.entry):2*x.entry-(valid&&x.pair===pair?p:x.entry)),0);
 const canOpen=valid&&q*p<=ledger.cash&&ledger.positions.length<20;
 function open(){if(!canOpen){setMessage('Invalid size or insufficient paper cash.');return;}setLedger(v=>({...v,cash:v.cash-q*p,positions:[...v.positions,{id:crypto.randomUUID(),pair,side,units:q,entry:p,openedAt:new Date().toISOString()}]}));setMessage('Simulated position opened. No broker order sent.');}
 function close(x){const exit=Number(price);if(x.pair!==pair||!Number.isFinite(exit)||exit<=0){setMessage('Select the position pair and enter a valid manual exit price.');return;}const pnl=(x.side==='buy'?1:-1)*(exit-x.entry)*x.units;setLedger(v=>({...v,cash:v.cash+x.units*x.entry+pnl,positions:v.positions.filter(z=>z.id!==x.id),history:[{...x,exit,pnl,closedAt:new Date().toISOString()},...v.history].slice(0,200)}));setMessage('Paper position closed at your entered price.');}
 function reset(){if(!window.confirm('Reset all locally stored paper positions and history?'))return;setLedger(initial);setMessage('Paper workspace reset.');}
 return <section className="panel paper-panel" aria-label="Paper trading terminal">
  <div className="panelhead"><div><h2>Paper trading terminal</h2><p>Manual scenario prices only · not live quotes · no Deriv or MT5 execution</p></div><span className="status active">SIMULATION</span></div>
  <div className="paper-metrics"><div><small>Paper cash</small><strong>$ {fmt(ledger.cash)}</strong></div><div><small>Marked equity*</small><strong>$ {fmt(equity)}</strong></div><div><small>Entry notional</small><strong>$ {fmt(exposure)}</strong></div><div><small>Open positions</small><strong>{ledger.positions.length}</strong></div></div>
  <div className="paper-form"><label>Instrument<select value={pair} onChange={e=>setPair(e.target.value)}>{PAIRS.map(x=><option key={x}>{x}</option>)}</select></label><label>Manual scenario price<input type="number" min="0.000001" step="any" value={price} onChange={e=>setPrice(e.target.value)}/></label><label>Units<input type="number" min="1" step="1" value={units} onChange={e=>setUnits(e.target.value)}/></label><label>Direction<select value={side} onChange={e=>setSide(e.target.value)}><option value="buy">Buy</option><option value="sell">Sell</option></select></label></div>
  <div className="paper-actions"><button className="primary" disabled={!canOpen} onClick={open}>Open paper position</button><button className="outline" onClick={reset}>Reset paper workspace</button></div>
  {message&&<p role="status" className="paper-message">{message}</p>}
  <h2 className="paper-subtitle">Open paper positions</h2><div className="tablewrap"><table><thead><tr><th>Pair</th><th>Side</th><th>Units</th><th>Entry</th><th>Action</th></tr></thead><tbody>{ledger.positions.length?ledger.positions.map(x=><tr key={x.id}><td>{x.pair}</td><td>{x.side}</td><td>{x.units}</td><td>{x.entry}</td><td><button className="outline" onClick={()=>close(x)}>Close at manual price</button></td></tr>):<tr><td colSpan="5">No paper positions</td></tr>}</tbody></table></div>
  <h2 className="paper-subtitle">Closed paper trades</h2><div className="tablewrap"><table><thead><tr><th>Pair</th><th>Side</th><th>Entry</th><th>Exit</th><th>P/L (USD)</th></tr></thead><tbody>{ledger.history.length?ledger.history.map(x=><tr key={x.id}><td>{x.pair}</td><td>{x.side}</td><td>{x.entry}</td><td>{x.exit}</td><td className={x.pnl>=0?'gain':'loss'}>{fmt(x.pnl)}</td></tr>):<tr><td colSpan="5">No closed paper trades</td></tr>}</tbody></table></div>
  <p className="paper-disclaimer">*Equity marks positions in the selected instrument at the manually entered price; other positions remain at entry. This is a local educational simulator, not a live-price feed, accounting ledger, or broker execution engine. Data stays in this browser and is not synchronized with Supabase. Short positions use fully collateralized notional and simplified P/L; spreads, fees, margin and FX conversions are omitted.</p>
 </section>;
}
