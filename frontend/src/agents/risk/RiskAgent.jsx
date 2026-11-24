import AgentCard from '../shared/AgentCard.jsx';

export default function RiskAgent({ analysis, ready, analyzing }) {
  return (
    <AgentCard title="Risk Agent" status={ready ? 'Updated' : analyzing ? 'Analyzing' : 'Waiting'}>
      {ready
        ? <p>{analysis.riskLevel} volatility · {Number.isFinite(Number(analysis.volatilityPct)) ? Number(analysis.volatilityPct).toFixed(4) : '—'}% average absolute move per bar.</p>
        : <p>Waiting for enough valid market candles.</p>}
    </AgentCard>
  );
}
