import AgentCard from '../shared/AgentCard.jsx';

export default function MarketDataAgent({ analysis, market, ready, analyzing, formatStatus }) {
  const status = ready ? 'Verified' : analyzing ? 'Checking' : analysis.status === 'blocked' || analysis.status === 'error' ? 'Paused' : 'Waiting';
  return (
    <AgentCard title="Market Data Agent" status={status}>
      {ready
        ? <p>{analysis.bars} verified closed candles on {market.name}. Latest bar closed at {new Date(analysis.reviewAt * 1000).toLocaleTimeString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })} EAT.</p>
        : <p>{analysis.block ? formatStatus(analysis.block) : analysis.status === 'error' ? 'Market feed unavailable. Checking again on the next cycle.' : 'Checking candle timestamps and prices.'}</p>}
    </AgentCard>
  );
}
