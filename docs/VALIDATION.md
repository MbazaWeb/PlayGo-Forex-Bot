# Validation

- Production frontend build: PASS (Vite 6.4.6).
- Authentication regression suite: 5/5 PASS using mocked provider responses.
- npm dependency audit after update: zero known vulnerabilities reported.
- MT5 adapter Python syntax: PASS.
- Local server smoke check: built HTML, health and session endpoints return 200.
- Missing Deriv configuration: login endpoint returns an explicit 503.
- Real Deriv login/account retrieval: NOT VERIFIED; OAuth client configuration required.
- MT5 terminal connection: NOT VERIFIED; terminal and account configuration required.
- Browser visual/interaction verification: NOT PERFORMED.
- Live order execution: implemented behind LIVE_TRADING_ENABLED and an account-specific LIVE_TRADING_CONFIRM. NOT VERIFIED against a live account.
- Live-readiness gate (shared/live-gate.js): unit-tested; not yet wired to a stored settlement history.
- Full backend and frontend test suite: 51/51 PASS (node --test, with dependencies installed via npm ci).

The source archive omits node_modules and generated dist. Run npm ci, npm test and npm run build.
