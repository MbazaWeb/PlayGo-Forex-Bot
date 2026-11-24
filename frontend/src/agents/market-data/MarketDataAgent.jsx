import AgentCard from '../shared/AgentCard.jsx';

export default function MarketDataAgent({ analysis, market, ready, analyzing, formatStatus }) {
  const status = ready ? 'Verified' : analyzing ? 'Analyzing' : 'Waiting';
  return (
    <AgentCard title="Market data" status={status}>
      {ready
        ? <p>{analysis.bars} closed candles on {market.name}. Latest bar closed at {new Date(analysis.reviewAt * 1000).toLocaleTimeString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })} EAT.</p>
        : <p>{analysis.block ? formatStatus(analysis.block) : 'Checking candle timestamps and prices.'}</p>}
    </AgentCard>
  );
}
