import React from 'react';
import Ticket from './Ticket';

export default function TicketSelector({ accounts, catalog }) {
  return <Ticket accounts={accounts} catalog={catalog} />;
}