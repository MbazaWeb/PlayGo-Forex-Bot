import AgentCard from '../shared/AgentCard.jsx';

export default function StrategiesAgent({ analysis, ready, analyzing }) {
  return (
    <AgentCard title="Strategies Agent" status={ready ? 'Updated' : analyzing ? 'Analyzing' : 'Waiting'}>
      {ready
        ? <p>{analysis.strategy || `SMA 20 ${analysis.sma20.toFixed(5)} · SMA 50 ${analysis.sma50.toFixed(5)} · RSI ${analysis.rsi.toFixed(1)} · momentum ${analysis.momentumPct.toFixed(3)}%`}</p>
        : <p>Trend, momentum, and RSI checks will appear after analysis.</p>}
    </AgentCard>
  );
}
