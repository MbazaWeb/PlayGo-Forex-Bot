import AgentCard from '../shared/AgentCard.jsx';

// Mirrors the backend's currencyScale so the preview matches the real submitted stake.
const currencyScale = (currency) => currency === 'USD' ? 100 : 1e8;

export default function FinanceAccountAgent({ accounts, agentStatuses, cappedAutomaticStake }) {
  return (
    <AgentCard title="Finance and Account Agents" status={accounts.length ? 'Checked' : 'Unavailable'}>
      {accounts.map((account, index) => {
        const latest = agentStatuses.find(item => item.accountId === account.account_id);
        const equity = latest?.result?.equity ?? latest?.equity;
        const balance = Number(account.balance);
        const nextStake = Number.isFinite(balance) && balance > 0
          ? Math.min(Math.floor(balance * 0.01 * currencyScale(account.currency)) / currencyScale(account.currency), cappedAutomaticStake ? 10 : Infinity)
          : null;
        return (
          <p key={account.account_id}>
            Account {index + 1} ({account.currency || 'currency'}) next stake:{' '}
            {Number.isFinite(nextStake) ? `${nextStake.toFixed(2)} ${account.currency || ''}` : 'unavailable'} · equity at last verified check:{' '}
            {Number.isFinite(equity) ? `${equity.toFixed(2)} ${account.currency || ''}` : 'awaiting verified trade check'}
          </p>
        );
      })}
    </AgentCard>
  );
}
