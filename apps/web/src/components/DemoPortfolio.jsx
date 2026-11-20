import React, {useState} from 'react';

export default function DemoPortfolio({accountId}) {
  const [view,setView] = useState(null);
  async function refresh(kind) {
    setView({loading:true});
    try {
      const response = await fetch('/api/demo/' + kind + '?account=' + encodeURIComponent(accountId));
      if (!response.ok) throw Error();
      setView(await response.json());
    } catch { setView({error:true}); }
  }
  return <section className="panel account-panel"><h3>Demo contracts · {accountId}</h3>
    <button className="outline" disabled={view?.loading} onClick={()=>refresh('portfolio')}>Read open contracts</button>
    <button className="outline" disabled={view?.loading} onClick={()=>refresh('history')}>Read closed trades</button>
    <button className="outline" disabled={view?.loading} onClick={()=>refresh('quote')}>Quote EUR/USD · 5 min Call · stake 1</button>
    <button className="outline" disabled={view?.loading} onClick={()=>refresh('operations')}>Execution and risk</button>
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
