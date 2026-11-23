# Execution risk controls

## Entry controls

- Demo is the default. Real buys require both server-side keys and a current, account-specific qualification record with separate logged human approval.
- The buy adapter checks TRADING_ENABLED=false before connecting and at the broker buy boundary. In a deployment, the flag must reach each active process.
- Per-order stake is at most 1% of authenticated balance and at most 10 USD for automatic USD entries. The automatic USD portfolio snapshot caps total stake at 1% of the lower of balance or equity. The broker and database checks cap open positions at five.
- Daily settlement P&L is measured from 00:00 EAT. The entry check blocks when net settlement P&L is at or below minus 5% of the starting balance. The bot declines entries when the 50-row lookback cannot establish coverage for the day.
- Three consecutive losses block new entries for 30 minutes from the latest loss. There is no loss-based stake increase. These are entry checks on broker snapshots, with no guarantee of a maximum realized loss.
- The position-count SQL change must be applied to the target database before relying on that database limit. The database and broker are separate systems, so portfolio snapshots are not an atomic broker exposure cap.

## Exit handling

A losing CALL/PUT can settle at zero proceeds. Early sale depends on Deriv allowing a sale and confirming the request. Stop-loss and take-profit thresholds are monitoring triggers. Monitoring is browser-page active. An unknown buy outcome blocks subsequent reservations. The existing drawdown control pauses entries at 80% of starting balance and tries to close broker-reported positions. Complete close/statement reconciliation and a persistent zero-proceeds-loss halt remain separate work.

## Qualification evidence

The execution role has read-only access to the qualification table. A separate trusted reviewer must supply the candidate account, approver, validity interval, predetermined holdout boundary, and unique settlement records with strategy, signal, verified reconciliation and explicit costs. No public write route or automatic approval exists. Missing data, an expired approval, or a failed check blocks a real buy. Reviewers are responsible for validating the dataset provenance, cost accounting and holdout boundary before recording approval.

The gate requires 500 settlements across three Monday-start EAT weeks, no single day above 50% of settlements, positive cost-adjusted results, profit factor of at least 1.2 and win rate above break-even. The holdout must contain at least 100 trades, have positive cost-adjusted P&L, profit factor of at least 1.2 and win rate above break-even. The PDF reports descriptive settlement metrics and cannot authorize live mode.

See VALIDATION.md for what was run.
