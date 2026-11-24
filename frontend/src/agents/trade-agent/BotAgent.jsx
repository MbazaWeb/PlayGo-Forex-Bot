import AgentCard from '../shared/AgentCard.jsx';

export default function BotAgent({ monitoringActive, agentRunning, ready, analyzing, recommendation, analysis }) {
  const status = monitoringActive ? 'Running' : agentRunning ? 'Settings required' : ready ? 'Ready' : analyzing ? 'Analyzing' : 'Waiting';
  return (
    <AgentCard title="Bot Agents" status={status}>
      <p className="agent-recommendation">{recommendation}</p>
      {ready && <p>{analysis.strategy}</p>}
      {ready && <p>Confluence score: {analysis.confluenceScore}/100 · {analysis.bars} bars checked.</p>}
    </AgentCard>
  );
}
