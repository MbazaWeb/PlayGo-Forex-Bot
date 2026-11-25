import AgentCard from '../shared/AgentCard.jsx';

export default function FinanceAccountAgent({ accounts, agentStatuses, stakeLimits }) {
  return (
    <AgentCard title="Finance and Account Agents" status={accounts.length ? 'Checked' : 'Unavailable'}>
      {accounts.map((account, index) => {
        const latest = agentStatuses.find(item => item.accountRef === account.accountRef);
        const equity = latest?.result?.equity ?? latest?.equity;
        const nextStake = stakeLimits?.accountRef === account.accountRef ? stakeLimits.stake : null;
        return (
          <p key={account.accountRef}>
            Account {index + 1} ({account.currency || 'currency'}) next stake:{' '}
            {Number.isFinite(nextStake) ? `${nextStake.toFixed(2)} ${account.currency || ''}` : 'unavailable'} · equity at last verified check:{' '}
            {Number.isFinite(equity) ? `${equity.toFixed(2)} ${account.currency || ''}` : 'awaiting verified trade check'}
          </p>
        );
      })}
    </AgentCard>
  );
}
