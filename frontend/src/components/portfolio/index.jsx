import React from 'react';
import Portfolio from './Portfolio';

export default function PortfolioSelector({ accountId, accountType }) {
  return <Portfolio accountId={accountId} accountType={accountType} />;
}