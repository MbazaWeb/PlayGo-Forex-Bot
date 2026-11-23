# Repository status

The application has a real-account-only Deriv execution path. Demo execution, demo portfolio UI, paper strategy workers, their database migrations, and associated routes have been removed from the application source.

Bot Agents can analyze live candles and, when explicitly started, request orders for all connected real accounts. The Emergency Agent monitors equity while the signed-in Bot Agents page is active, pauses new orders at a 20% drawdown from the starting balance, and attempts to close open contracts.

Bot Agents also support a one-time order check that uses server-side analysis, automatic 1%-of-balance sizing, and required per-contract stop-loss/take-profit percentages. Deriv exits are monitored and best-effort; FOK is not supported by the current CALL/PUT path.

Automated tests use fake broker responses only. No live order has been placed or used for validation. Before execution can work in a deployment, its operator must configure the server-side live gate and apply `backend/deriv_execution/real_execution.sql` to the intended database. This repository does not apply the migration to a hosted database.

The 75/100 score is an indicator-confluence score, not a measured win probability. A best-effort close request cannot guarantee a 20% maximum loss. Emergency monitoring stops when the Bot Agents page/session stops.
