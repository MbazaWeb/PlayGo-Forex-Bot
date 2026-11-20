import React, {useState} from 'react';

export default function DemoPortfolio({accountId}) {
  const [view,setView] = useState(null);
  const [direction,setDirection]=useState('CALL');
  const [minutes,setMinutes]=useState(15);
  const [stake,setStake]=useState(1);
  async function refresh(kind) {
    setView({loading:true});
    try {
      const response = await fetch('/api/demo/' + kind + '?account=' + encodeURIComponent(accountId) + (kind==='quote' ? '&'+new URLSearchParams({direction,minutes,stake}) : ''));
      if(response.status===401) return setView({expired:true});
      if(response.status===429) return setView({limited:true});
      if (!response.ok) throw Error();
      setView(await response.json());
    } catch { setView({error:true}); }
  }
  return <section className="panel account-panel"><h3>Demo contracts · {accountId}</h3>
    <button className="outline" disabled={view?.loading} onClick={()=>refresh('portfolio')}>Read open contracts</button>
    <button className="outline" disabled={view?.loading} onClick={()=>refresh('history')}>Read closed trades</button>
    <fieldset><legend>EUR/USD demo quote</legend>
    <label>Direction <select value={direction} onChange={e=>setDirection(e.target.value)}><option>CALL</option><option>PUT</option></select></label>
    <label> Minutes <input type="number" min="1" max="60" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
    <label> Stake <input type="number" min="0.01" max="1" step="0.01" value={stake} onChange={e=>setStake(e.target.value)}/></label>
    <button className="outline" disabled={view?.loading || !Number.isInteger(Number(minutes)) || minutes<1 || minutes>60 || stake<=0 || stake>1} onClick={()=>refresh('quote')}>Quote EUR/USD</button></fieldset>
    {view?.expired && <a href="/api/auth/deriv/start">Sign in again with Deriv</a>}
    {view?.limited && <p>Deriv rate limit reached. Try again later.</p>}
    <button className="outline" disabled={view?.loading} onClick={()=>refresh('operations')}>Execution and risk</button>
    {view?.status && <p>Account switch {view.status.paused?'paused':'armed'} · Realized P&L today (UTC) {view.status.dailyRealizedPnl ?? 'unverified'} · Last completed recovery {view.status.lastRecoveryAt ? new Date(view.status.lastRecoveryAt).toLocaleString() : 'never recorded'}</p>}
    {view?.limits && <><p>{view.worker} · Max stake {view.limits.maxStake} · Daily loss limit {view.limits.maxDailyLoss} · Open limit {view.limits.maxOpenContracts} · Cooldown {view.limits.minSecondsBetweenTrades}s</p>
    {view.intents.length ? view.intents.map((r,i)=><p key={i}>{r.strategy_id} · {r.symbol} · {r.status} · {r.updated_at}</p>) : <p>No recorded execution intents.</p>}</>}
    {view?.proposal && <p>EUR/USD {view.tick.price} · Ask {view.proposal.ask} · Payout {view.proposal.payout} {view.currency} · {new Date(view.tick.epoch*1000).toLocaleTimeString()}</p>}
    {view?.transactions && <><p>Latest {view.transactions.length} closed trades · {new Date(view.observedAt).toLocaleString()}</p>
    {view.transactions.map(t=><p key={t.id}>{t.id} · Bought {t.buy} · Sold {t.sell}</p>)}</>}
    <div role="status">{view?.loading && 'Connecting to Deriv…'}{view?.error && 'Broker portfolio unavailable.'}
    {view?.contracts && <><p>Broker snapshot · {new Date(view.observedAt).toLocaleString()}</p>
    {view.contracts.length ? view.contracts.map(c => <p key={c.id}>{c.id} {c.symbol}</p>) : 'No open contracts.'}</>}</div>
  </section>;
}
