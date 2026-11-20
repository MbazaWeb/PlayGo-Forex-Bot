# Phase 7D development review

Base branch development/phase7-atomic-execution, GitHub commit d39ea5149de87f135e224722ad122dcdcb7df9e9. Local patch only. No push, merge, preview, deployment or purchase was performed.

## Verification

The checkout exposed 31 tests. Two earlier Phase 7 packages restored 32 additional passing cases. The historical report of 64 could not be matched test-for-test. The combined revised suite passes 76 cases. The root test command now discovers API, worker and frontend risk tests. Vite builds successfully. The existing application uses JSX/JavaScript and has no configured TypeScript project. npm audit returned zero reported vulnerabilities for this lockfile.

Broker tests use injected transports. The database transaction test runs the checked-in SQL in embedded PostgreSQL (PGlite), including rollback on an audit error, duplicate claims, audit immutability and denial of the reservation RPC to authenticated clients. It is single-session testing. It does not certify contention across independent PostgreSQL connections.

Read-only inspection of PlayGo-Forex-Bot in Supabase confirmed the intents, audit and MT5 tables have RLS, the one-unresolved-intent index and immutable audit trigger exist, and authenticated and anonymous roles lack execute permission on the existing atomic transition RPC. No remote migration ran. The new reserve.sql is required before using the revised reservation worker. Existing reservations survive upgrade. A reservation with no matching audit needs manual review.

## Implementation

Both API entry points provide authenticated demo-only portfolio, recent closed trades, market quote and execution status reads. The quote checks contract availability before reading the first streamed tick and proposal, then closes the socket. The transport renews its OTP for one reconnect on disconnect or timeout. Rate-limited socket reads stop. Browser sessions expire and require renewed sign-in. No broker access token, OTP or service-role key belongs in a frontend variable.

The recovery command reads server-owned account-scoped intents and fetches evidence via that account's authenticated socket. It only transitions intents already bound to a matching broker contract. The durable database state is the checkpoint across restarts. Missing associations stay held. Concurrent conflicting transitions are rejected by the existing row lock and legal state checks. The order-flow qualification harness has only an injected test transport.

## Outstanding release gates

* Perform authenticated Deriv demo sign-in, portfolio/history/quote checks, session-expiry checks and reconciliation against an independently known contract. Current code uses Options API contracts on forex symbols. MT5 remains a separate read-only bridge.
* Verify account-level aggregate daily P&L, loss streak, cooldown, kill-switch updates and risk-state freshness under concurrent workers in isolated staging. The risk evaluator currently accepts a state snapshot from its caller. The UI shows policy defaults and intent states. Worker heartbeat, managed strategy configuration, a persistent operator kill switch and an authoritative P&L ledger still need integration.
* Review worker identity permissions, apply only the new reservation RPC to staging and verify privileges with actual worker credentials. Run rollback, crash and multi-connection concurrency scenarios there.
* Complete credential renewal and rate-limit qualification, TypeScript verification if required, and signed-in desktop/mobile browser acceptance. The build check does not cover these.
* Production broker submission has no wired transport. Qualify every gate before a separate decision on demo submission. No real-account path is approved.

## Later release procedure

1. In a local development checkout based on the specified GitHub commit, apply the included Git patch with git am or use the extracted source. Use Node 22 or later and run npm ci, npm test and npm run build.
2. Run npm run server in one terminal and npm run dev in another. Set APP_ORIGIN and the exact registered callback in DERIV_REDIRECT_URI. Use HTTPS outside localhost. Keep privileged Supabase settings server-only. Configure the cookie encryption secret on the serverless handler.
3. Check the target project reference, schema, grants and existing functions. Review the single new migration backend/deriv_execution/reserve.sql. Verify it first on isolated staging with the actual worker role. Preserve existing schema, hardening and transition migrations.
4. For an explicitly configured demo recovery exercise only, the recovery process uses DERIV_DEMO_TOKEN, DERIV_DEMO_ACCOUNT_ID, DERIV_CLIENT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLAYGO_DEMO_EXECUTION_ENABLED=true and LIVE_TRADING_ENABLED=false. npm run recover:demo performs one pass. Expired credentials must be renewed server-side. Avoid logging environment values. Keep ordinary web execution disabled.
5. After all outstanding gates pass, record results, confirm branch deployment exclusions and request explicit deployment approval. Only after DEPLOY NOW, release the reviewed build with submission disabled and smoke-test sign-in and read-only dashboard views. Roll back the application release if these fail. Preserve unresolved database records for reconciliation.

## Repeatable local PostgreSQL staging check

From the repository root run `npm ci` followed by `npm run verify:postgres` on Node 22 or later. This starts a disposable, loopback-only native PostgreSQL cluster, applies all six execution and strategy SQL files, models the worker permissions, exercises competing sessions and checks the settled balance and audit history after restart. The runner removes its temporary cluster on completion. Use `npm test` for the separate app regression suite. The application still uses its Supabase REST endpoints during normal operation.
