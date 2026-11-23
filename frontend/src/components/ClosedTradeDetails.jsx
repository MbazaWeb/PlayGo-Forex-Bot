import React, { useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { brokerRequest } from './brokerRequest';

export default function ClosedTradeDetails({ trade, accountId, currency, settledTime, onClose }) {
  const [audit, setAudit] = useState(null);
  const contractId = trade.contractId;
  useEffect(() => {
    if (!contractId) return;
    let active = true;
    const query = new URLSearchParams({ account: accountId, report: '1' });
    async function loadEvidence() {
      try {
        const response = await brokerRequest('/api/history?' + query);
        if (!response.ok) throw new Error('Trade audit unavailable');
        const data = await response.json();
        if (data.accountId !== accountId || !data.evidence) throw new Error('Trade audit unavailable');
        if (active) setAudit({ detail: data.evidence[contractId] });
      } catch {
        if (active) setAudit({ error: true });
      }
    }
    void loadEvidence();
    return () => { active = false; };
  }, [accountId, contractId]);

  const detail = audit?.detail;
  const exit = detail?.exit;
  const profit = trade.sell - trade.buy;
  const money = amount => amount.toFixed(2) + ' ' + currency;
  const hasTime = Number.isSafeInteger(trade.settledAt) && trade.settledAt > 0 && trade.settledAt < 1e11;
  const result = profit < 0 ? 'Loss' : profit > 0 ? 'Win' : 'Break-even';
  const exitSummary = exit?.outcome === 'CLOSED' ? 'Deriv confirmed an early close.'
    : exit?.canSell === false ? 'Deriv did not offer an early sale at the recorded check.'
      : exit ? 'PlayGo did not receive close confirmation.' : 'The exit cause is unavailable in the trade audit.';
  const suggestion = exit?.canSell === false
    ? 'On Demo, review when early sale is available. Set the stake assuming the full amount can be lost.'
    : exit && exit.outcome !== 'CLOSED'
      ? 'Reconcile this contract against the Deriv statement before changing exit rules.'
      : 'Compare this setup with more Demo trades using the same market, strategy, and duration before changing entry rules.';

  return (
    <ConfirmDialog title="Closed trade details" cancelLabel="Close" onCancel={onClose}>
      <p>{contractId ? 'Contract #' + contractId : 'Transaction #' + trade.id}</p>
      <dl>
        <dt>Result</dt><dd><strong data-outcome={result}>{result} · {profit > 0 ? '+' : ''}{money(profit)}</strong></dd>
        <dt>Stake / proceeds</dt><dd>{money(trade.buy)} / {money(trade.sell)}</dd>
        <dt>Settled (EAT)</dt><dd>{hasTime ? settledTime.format(trade.settledAt * 1000) : 'Unavailable'}</dd>
      </dl>
      {contractId && !audit && <p role="status">Loading strategy and exit evidence…</p>}
      {(!contractId || audit) && <>
        {audit?.error && <p role="status">Trade audit could not be loaded.</p>}
        <dl>
          <dt>Strategy</dt><dd>{detail?.strategy || 'Unavailable'}{Number.isFinite(detail?.score) && ' · Signal ' + detail.score + '/100'}</dd>
          <dt>Market / direction</dt><dd>{detail?.symbol || 'Unavailable'} · {({ CALL: 'Rise', PUT: 'Fall' })[detail?.direction] || 'Unavailable'}{detail?.duration ? ' · ' + detail.duration + ' min' : ''}</dd>
        </dl>
        <h3>{profit < 0 ? 'Why it lost' : 'Exit evidence'}</h3>
        {profit < 0 && <p>{trade.sell === 0 ? 'The contract returned zero proceeds, so the full stake was lost.' : 'Settlement proceeds were below the original stake.'}</p>}
        <p>{exitSummary}</p>
        <h3>Suggested improvement</h3>
        <p>{suggestion}</p>
      </>}
    </ConfirmDialog>
  );
}
