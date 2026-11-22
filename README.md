# PlayGo Trading

PlayGo Trading is a React/Vite trading workspace with a Node API for Deriv OAuth2/PKCE and an isolated, read-only MetaTrader 5 adapter.

## Features

- Deriv OAuth authorization-code + PKCE login and secure server-side session handling
- Deriv Options account retrieval (configuration and broker testing required)
- React/Vite frontend with a Deriv demo Options ticket and account activity
- Windows MT5 read-only snapshot adapter (not connected to the API)
- API authentication regression tests

The optional demo worker evaluates the selected EUR/USD strategy and records account-scoped signals. Historical replay and strategy history are paper simulations, not broker orders. See [worker setup](docs/SIGNAL_WORKER.md). Real-money API routes are hard-disabled. The market catalog contains static metadata; chart prices come from Deriv's public historical feed.

## Trading modes and safety

- `/api/live/ticket`, `/api/live/strategy`, and `/api/live/portfolio` always return `403`. Setting an environment variable cannot enable real-money execution.
- The Trading Bots and Portfolio pages use demo accounts only. Paper replay/history is separate from the Deriv demo account and must not be interpreted as broker P&L.
- The Trading Terminal reads the selected Deriv demo balance, open contracts, and closed trades through the authenticated backend. The order ticket above that activity panel submits Deriv Options contracts using Deriv virtual funds when the demo execution gates pass.
- Strategy replay and strategy history remain paper simulations; they do not represent broker-account positions or P&L. `paper_pack.sql` stores worker-generated simulated strategy fills, not manual forex or Deriv Options positions.
- Demo broker submission is a separate, account-scoped path. Its readiness check reports qualification, pause state, unresolved intents, the latest recovery timestamp, and verified daily P&L; any failed or stale check blocks submission.
- A recovery result with `observed: 0` means the recovery query found no unresolved intents to inspect. Recovery heartbeat does not qualify an account or clear its paused state, and a zero count alone does not make the preflight ready.
- Public market-data requests close their WebSocket after each response, abort on component cleanup, and retry transient read failures with bounded backoff.

## Local setup

Requires Node.js 22+.

```bash
npm install
cp .env.example .env
npm test
npm run build
```

Configure `DERIV_CLIENT_ID` and the exact registered callback in `.env`. On Windows PowerShell, replace `cp` with `Copy-Item` if preferred. Start both services from the repository root.

```bash
npm run dev       # Starts the Node API and Vite together
```

Open http://localhost:5173.

For the Vercel multi-service dev path, run `node backend/api/src/vercel-dev-server.js` (defaults to port 3000, binds to `127.0.0.1`; override with `PORT` and `PLAYGO_DEV_HOST`).

Deriv callback: `http://localhost:5173/api/auth/deriv/callback`. Production uses a same-origin HTTPS callback and a single Node backend because sessions are currently process-local. Review `docs/ARCHITECTURE.md` before deployment. **Never commit `.env`, access tokens, API secrets, or MT5 credentials.**

## Code quality

Lint and formatting checks:

```bash
npm run lint     # ESLint
npm run format   # Prettier (write)
npm run format:check
```

See `CONTRIBUTING.md` for the contribution workflow and `SECURITY.md` for vulnerability reporting.

## Project layout

- `frontend`: Vite web app and client code
- `backend/api`: Node API, Deriv authentication, and API tests
- `backend/trading`: server-side trading logic
- `backend/deriv_execution`: database migrations
- `backend/mt5`: read-only Windows MT5 adapter
- `docs`: architecture, source audit, validation and import notes

## References

- https://developers.deriv.com/docs/intro/oauth/
- https://developers.deriv.com/docs/options/get-accounts/
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
