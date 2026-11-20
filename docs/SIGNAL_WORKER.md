# Background EUR/USD signals

Apply backend/deriv_execution/strategy.sql once to an inspected, isolated staging database in a transaction. Configure the server-side worker with DERIV_DEMO_ACCOUNT_ID, DERIV_DEMO_TOKEN, DERIV_CLIENT_ID, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Keep LIVE_TRADING_ENABLED=false and set PLAYGO_SIGNAL_WORKER_ENABLED=true only for the signal process.

Run npm run strategy:demo -- --once for one pass or npm run strategy:demo for periodic checks. In Trading Bots, save the periods and select Enable on worker for the corresponding demo account. Read worker status shows the most recent completed candle minute. The worker must be running to update it. Pausing signals or changing periods invalidates pending results from the earlier configuration. The worker reads market data only.
