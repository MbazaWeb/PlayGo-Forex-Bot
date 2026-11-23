# Real execution risk controls

## Configured limits

- Per-order stake: at most 1% of the latest authenticated account balance.
- Open contracts: at most five per real account.
- Per-contract stop-loss and take-profit: required user inputs, persisted with each account control and used as the authority for scheduled checks. They use monitored floating P&L and best-effort sell requests, not broker-side guarantees.
- Emergency threshold: pause new orders when verified equity is at or below 80% of the stored starting balance.
- Emergency action: persist the pause first, then attempt to sell each broker-reported open contract. While the Bot Agents page remains active, later checks retry contracts still reported open.
- Scheduling: selected candle interval, page-active only. The one-time order action reruns server-side analysis and does not bypass the signal threshold.
- Fill policy: Deriv CALL/PUT proposal/buy does not offer FOK; execution buys at no more than the quoted proposal price.

Starting balance is captured when an account is first started and remains unchanged across ordinary stop/start actions. A risk-triggered pause cannot be cleared by starting again. Unknown order outcomes also pause the account to prevent duplicate submissions.

These controls do not guarantee a maximum loss. Market movement, network interruptions, broker rejection, gaps, or execution price can prevent or worsen a close. Monitoring is page-active, not continuous after the browser/session stops.

## Validation status

The migration and execution logic are tested with an embedded PostgreSQL implementation and mocked broker WebSockets. Tests do not call live buy or sell endpoints. The migration has not been applied to a hosted database, and no live-account acceptance run has been performed.
