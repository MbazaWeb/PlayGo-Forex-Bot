# Account and execution boundaries

The browser calls the same-origin Node API. The API redirects to Deriv, holds PKCE state
for five minutes, exchanges the code server-side and stores the returned token in memory.
Only an opaque session ID goes into an HttpOnly SameSite=Lax cookie.
Tokens are never returned to the browser or stored in localStorage.

GET /api/accounts only uses the current session's token. It accepts no arbitrary account
or user token parameter. Unknown provider payload shapes fail instead of showing fabricated balances.
The current adapter accepts array data or an accounts array; verify the payload shape against
your registered Deriv app before production.

Sessions last for the lesser of the provider lifetime and eight hours. Restarting logs everyone out.
OAuth retries are bounded by a 1000-entry pending-flow cap; add per-client rate limiting at ingress.
Account calls time out after 15 seconds. Provider 401 responses invalidate the local session.
Production cookies are Secure. Production requires HTTPS, same-origin callback and app URLs.
Logout rejects cross-origin requests. Authentication codes and tokens are not logged.

MT5 is a separate terminal/account context. The manual Python adapter verifies the exact login
and server before emitting a read-only snapshot. It is not exposed over HTTP.
Deriv OAuth does not establish MT5 account ownership. Implement explicit linking before wiring
MT5 snapshots into any session.

Design-preview data is isolated and labeled. It never populates the signed-in account page.
The account-scoped demo order path is guarded by demo risk checks. Real-money routes always
return 403. There are no deposit, withdrawal or transfer operations in this build.

## Future real-money work (not enabled)

1. Configure and verify Deriv OAuth against your account, including expiry and denied consent.
2. Validate actual provider account schemas; add broker-backed market data.
3. Choose durable encrypted session/credential storage and verified user identities.
4. Implement and verify explicit MT5 account ownership, authenticated Windows-worker transport.
5. Implement broker-specific execution adapters, decimal sizing, lot/contract validation,
   server-side exposure/loss limits, stale quote protection and emergency stop.
6. Add durable idempotency, order state transitions, ledger entries and reconciliation.
7. Keep real-money routes hard-disabled. Any future broker work requires a separate design, review, and explicit approval.
8. Complete deployment hardening, monitoring, backups and recovery verification.

These items are absent functionality, not features switched off by an environment flag.
