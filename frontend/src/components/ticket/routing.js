export function ticketApiBase(accountType) {
  return accountType === 'demo' ? '/api/demo' : null;
}
