import AgentCard from '../shared/AgentCard.jsx';

export default function EmergencyAgent({ monitoringActive, agentRunning }) {
  const status = monitoringActive ? 'Monitoring' : agentRunning ? 'Settings required' : 'Standby';
  return (
    <AgentCard title="Emergency Agent" status={status}>
    </AgentCard>
  );
}
