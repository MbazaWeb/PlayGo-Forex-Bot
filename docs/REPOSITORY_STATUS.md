# Repository status

The application has Deriv execution for selected Demo and Real accounts, with a server-confirmed active account shared across the app. Account identifiers are masked in API responses and the UI. Real account selection requires confirmation; switching accounts is blocked while current positions are open or cannot be verified.

Bot Agents analyze live candles and request orders for the selected account. Per-account auto-start is disabled by default. The Emergency Agent monitors equity while the signed-in Bot Agents page is active, pauses new orders at a 10% drawdown from the starting balance, and attempts to close open contracts.

All order modes use server-side 1%-of-balance sizing capped at $10 USD-equivalent; non-USD orders fail closed if a valid Deriv exchange rate is unavailable. Manual terminal Buy/Sell can bypass signal qualification only; live-account, persistence, and risk gates still apply. Stop-loss/take-profit are best-effort early-exit requests, not broker-side guarantees; the full stake can be lost.

Automated tests use fake broker responses only. No live order has been placed or used for validation. Before relying on the new database-backed controls, the operator must configure the server-side live gate and apply `backend/deriv_execution/real_execution.sql` to the intended database. This repository does not apply the migration to a hosted database.

The 75/100 score is an indicator-confluence score, not a measured win probability. A best-effort close request cannot guarantee a 10% maximum loss. Emergency monitoring stops when the Bot Agents page/session stops.
