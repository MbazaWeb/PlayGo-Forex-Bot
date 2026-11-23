# Real execution risk controls

## Entry controls

- Per-order stake: at most 1% of the latest authenticated balance, and at most 10 USD for automatic USD entries.
- Open contracts: at most five per real account (`MAX_OPEN_CONTRACTS`).
- Daily loss cap: new entries stop for the rest of the Tanzania day (EAT) once today's net settled P&L is at or below -5% of the stored starting balance.
- Loss-streak cooldown: after three consecutive losses, new entries stop for 30 minutes from the most recent loss.
- Fail-closed history: if the settlement history cannot prove the day's P&L, no new entry is placed (`DAILY_HISTORY_INCOMPLETE`).
- Two-key live switch: real orders require `LIVE_TRADING_ENABLED=true` and `LIVE_TRADING_CONFIRM` set to the exact real account ID. Demo accounts need neither.

## Exit controls, stated plainly

Deriv CALL/PUT contracts are binary. A losing contract settles at zero, so the stake is the maximum loss, and the configured stop-loss cannot limit a loss below the stake. Early sale is offered only sometimes, and the bot can only sell when Deriv reports `is_valid_to_sell`. The automatic take-profit of 30 USD is above the payout of a 10 USD stake and is effectively never reached. Stop-loss and take-profit should be read as monitoring thresholds, not guarantees.

## Emergency controls

- Emergency threshold: pause new orders when verified equity is at or below 80% of the stored starting balance, then attempt to sell each broker-reported open contract.
- Unknown order outcomes pause the account to prevent duplicate submissions.
- A risk-triggered pause cannot be cleared by starting again.

## Live-readiness gate

Live trading should not be enabled until `shared/live-gate.js` reports `passed: true` on the settlement history. The gate requires:

- at least 500 settled trades,
- trades across at least 3 separate weeks (Monday-start, EAT),
- no single day holding more than 50% of trades,
- net P&L after costs above zero,
- profit factor at least 1.2,
- win rate above the break-even rate for the actual payout,
- the most recent 30% of trades (minimum 100) net positive,
- every trade carrying a recorded strategy and a broker settlement record.

Thresholds are constants in code. Changing them is a code change and needs review.

## What these controls do not do

They do not guarantee a maximum loss. Market movement, network interruptions, broker rejection, and execution price can prevent or worsen a close. Monitoring runs only while the page is active. The strategy's signal score is a heuristic and has not been validated as predictive.

## Validation status

Unit tests cover the gate, the risk helpers, and the paged settlement reader. The full suite (51 tests) passes against mocked broker and database responses. No live-account acceptance run has been performed, and the execution migration has not been verified against a hosted database.
