# Security Policy

## Supported Versions

Security fixes are applied to the latest `main` branch.

## Reporting a Vulnerability

Please report vulnerabilities privately to the maintainer. Do not open a public issue with credentials or a working exploit.

## Scope

In scope:

- Deriv OAuth2/PKCE, cookies, session handling, and account ownership checks
- CSRF protection and authorization of state-changing routes
- Real-money order execution, emergency pause/close handling, idempotency, and risk enforcement
- Database grants, RLS, SQL input validation, and migration behavior
- Secret exposure, logging, and static-file path handling

## Execution safeguards

- Only accounts returned by the authenticated Deriv session with `account_type: real` can reach execution.
- Real orders require the server-side `LIVE_TRADING_ENABLED=true` gate and durable real-execution controls.
- The database stores starting balances, order state, and an audit trail; it does not store Deriv OAuth tokens.
- Stake is limited to 1% of current balance per order; the account is limited to five open contracts.
- The Emergency Agent pauses new orders at a 20% drawdown from the stored starting balance and attempts to close open contracts. Broker close requests may fail or fill at a different price; this is not a guaranteed loss cap.
- Emergency monitoring runs only while the signed-in Trade Agent page is active. It is not a 24/7 background service.
- The 75/100 signal score is indicator confluence, not a validated win probability.
- Tests use mocks and do not call real buy or sell endpoints.

OAuth tokens remain in the authenticated server session and are never returned to frontend code or stored in localStorage. State-changing requests require both a same-origin `Origin` header and `X-PlayGo-Request: 1`.
