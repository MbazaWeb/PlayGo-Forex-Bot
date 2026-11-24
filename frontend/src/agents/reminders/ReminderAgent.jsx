import AgentCard from '../shared/AgentCard.jsx';
import INTERVALS from '../intervals.js';

export default function ReminderAgent({ analysis, ready, interval }) {
  return (
    <AgentCard title="Reminder Agent" status={ready ? 'Ready' : 'Waiting'}>
      {ready
        ? <p>Review after the next {INTERVALS.find(([seconds]) => seconds === interval)?.[1]} candle, around {new Date(analysis.reviewAt * 1000).toLocaleTimeString()}.</p>
        : <p>Reminder timing is based on the latest retrieved candle.</p>}
    </AgentCard>
  );
}
