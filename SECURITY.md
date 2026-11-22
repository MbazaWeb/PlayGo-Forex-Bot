# Security Policy

## Supported Versions

PlayGo Trading is a prototype foundation, not a production real-money execution system. Security fixes are applied to the latest `main` branch only.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email the maintainer directly with a description, reproduction steps, and impact assessment.
3. You should receive an acknowledgment within 72 hours.

## Scope

The following are in scope:

- Authentication / session handling (Deriv OAuth2/PKCE, cookie sealing)
- Cross-site request forgery (CSRF) bypasses on state-changing routes
- Input validation / injection in API routes and SQL migrations
- Path traversal in static file serving
- Secrets exposure (committed credentials, token leakage in logs)

The following are **out of scope** as they are intentionally disabled by design:

- Broker order submission routes (`/api/orders`, `/api/bots`) — these return `501` by design
- Real-money routes (`/api/live/ticket`, `/api/live/strategy`, `/api/live/portfolio`) — these always return `403`

## Security Posture

- Real-money execution is **hard-disabled** in both API handlers; environment flags cannot enable it.
- Demo broker submission is a separate, explicitly gated path. It requires verified demo account ownership and passing risk/recovery preflight checks.
- The demo account activity panel uses authenticated backend reads. Only the demo order ticket can submit Deriv demo contracts, and it remains blocked unless execution and risk preflight gates pass.
- Strategy replay/history and `playgo_pack_trades` are paper simulations, not broker-account records.
- Tokens are stored server-side in memory only; only an opaque session ID is placed in an HttpOnly cookie.
- Production cookies are `__Host-` prefixed, `Secure`, `SameSite=Lax`.
- CSRF protection requires both `Origin` header match and a custom `X-PlayGo-Request: 1` header on state-changing requests.
- Content-Security-Policy is applied to all responses.
