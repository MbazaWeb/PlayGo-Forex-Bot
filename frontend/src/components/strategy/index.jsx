import React from 'react';
import Strategy from './Strategy';

export default function StrategySelector({ accountId, accountType }) {
  return <Strategy accountId={accountId} accountType={accountType} />;
}