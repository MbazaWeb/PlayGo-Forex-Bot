import AgentCard from '../shared/AgentCard.jsx';

export default function StrategiesAgent({ analysis, ready, analyzing }) {
  return (
    <AgentCard title="Strategies Agent" status={ready ? 'Updated' : analyzing ? 'Analyzing' : 'Waiting'}>
      {ready
        ? <p>{analysis.strategy || `SMA 20 ${Number.isFinite(Number(analysis.sma20)) ? Number(analysis.sma20).toFixed(5) : '—'} · SMA 50 ${Number.isFinite(Number(analysis.sma50)) ? Number(analysis.sma50).toFixed(5) : '—'} · RSI ${Number.isFinite(Number(analysis.rsi)) ? Number(analysis.rsi).toFixed(1) : '—'} · momentum ${Number.isFinite(Number(analysis.momentumPct)) ? Number(analysis.momentumPct).toFixed(3) : '—'}%`}</p>
        : <p>Trend, momentum, and RSI checks will appear after analysis.</p>}
    </AgentCard>
  );
}
