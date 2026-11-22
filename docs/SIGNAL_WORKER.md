# Demo strategy worker

The Trading Bots page uses the uploaded pack’s 24 rule implementations. Its other 26 catalog entries need specialist inputs or models. Replay uses historical EUR/USD candles from Deriv. It runs independently of the background worker and does not write trades.

For a persistent local installation, inspect the existing PostgreSQL schema. Apply missing migrations in the order in `scripts/verify-local-postgres.mjs`. The incremental migration for existing strategy installations is `backend/deriv_execution/paper_pack.sql`. Apply it once in a transaction before starting the updated API and worker.

The strategy worker and broker recovery process are not part of routine local validation. They require a persistent database and authenticated Deriv credentials; the recovery process also writes a worker heartbeat and may reconcile existing intents. Do not start these processes against a hosted database as part of this guide. Keep `PLAYGO_SIGNAL_WORKER_ENABLED=false`, `PLAYGO_DEMO_EXECUTION_ENABLED=false`, and `PLAYGO_BROKER_DEMO_ACCOUNT` empty for the safe local setup.

The paper worker evaluates consecutive completed one-minute EUR/USD candles and records simulated fills, checkpoints, P&L, and trade counts. A daily realized paper loss limit pauses paper fills for that UTC day. Paper fills exclude spread, slippage, and commissions. Broker demo execution is a separate capability and is not exercised by the paper worker instructions here.

A recovery result with `observed: 0` means the recovery query found no unresolved intents to reconcile. The process still writes its heartbeat, but this count does not qualify an account, clear its paused state, or by itself make a demo ticket ready. The readiness check independently requires qualification, an unpaused account, no unresolved intents, a recent heartbeat, and verified daily P&L.

The `automation_mode.sql` migration adds manual and system-selected paper strategy modes. System automation uses completed close-to-close changes to choose a strategy or produce no signal on flat prices. The worker and historical replay share this rule; neither paper mode implies broker orders.
