# Demo strategy worker

The Trading Bots page uses the uploaded pack’s 24 rule implementations. Its other 26 catalog entries need specialist inputs or models. Replay uses historical EUR/USD candles from Deriv. It runs independently of the background worker and does not write trades.

For a persistent local installation, inspect the existing PostgreSQL schema. Apply missing migrations in the order in `scripts/verify-local-postgres.mjs`. The incremental migration for existing strategy installations is `backend/deriv_execution/paper_pack.sql`. Apply it once in a transaction before starting the updated API and worker.

Run the API and worker against the same database. For local PostgREST configure `PLAYGO_ENV=local`, `PLAYGO_LOCAL_REST_URL`, and `PLAYGO_LOCAL_WORKER_JWT`. Configure `DERIV_DEMO_ACCOUNT_ID`, `DERIV_CLIENT_ID`, and `DERIV_DEMO_TOKEN` on the worker. Set `LIVE_TRADING_ENABLED=false` and `PLAYGO_SIGNAL_WORKER_ENABLED=true`. Start the process with `npm run strategy:demo`. The worker requires a persistent host and a reachable database.

In Trading Bots select the worker strategy and enable it for the matching demo account. Each pass evaluates consecutive completed one-minute EUR/USD candles. A directional signal simulates 100 units from the next bar’s open to its close. A conditional database update records the fill, checkpoint, realized USD P&L, and trade count atomically. Missing bars, changed configurations, and pauses discard pending signals. A daily realized loss of $200 pauses paper fills for that UTC day. The status button reads saved configuration and the latest 25 paper fills. Paper fills exclude spread, slippage, and commissions. The broker purchase gate is separate and remains locked pending qualification.
