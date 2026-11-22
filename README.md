# PlayGo Trading

PlayGo Trading is a React/Vite trading workspace with a Node API for Deriv OAuth2/PKCE and an isolated, read-only MetaTrader 5 adapter.

## Features

- Deriv OAuth authorization-code + PKCE login and secure server-side session handling
- Deriv Options account retrieval (configuration and broker testing required)
- React/Vite frontend with a separately labeled simulated trading workspace
- Windows MT5 read-only snapshot adapter (not connected to the API)
- API authentication regression tests

The optional demo worker evaluates the selected EUR/USD strategy, records signals, and settles simulated trades in PostgreSQL. Trading Bots includes historical replay and an account-scoped paper trade history. See [worker setup](docs/SIGNAL_WORKER.md). It runs separately from the web app. The order ticket previews hypothetical trades. Broker submission is locked pending demo qualification, and real-money execution is disabled. Market charts use historical Deriv prices. The example bot results and watchlist are simulated.

## Local setup

Requires Node.js 22+.

```bash
npm install
cp .env.example .env
npm test
npm run build
```

Configure `DERIV_CLIENT_ID` and the exact registered callback in `.env`. On Windows PowerShell, replace `cp` with `Copy-Item` if preferred. Start the two services in separate terminals:

```bash
npm run server   # Node API on http://127.0.0.1:3001 (PORT env overrides)
npm run dev       # Vite dev server on http://127.0.0.1:5173, proxies /api → 3001
```

Open http://localhost:5173.

For the Vercel multi-service dev path, run `node apps/api/src/vercel-dev-server.js` (defaults to port 3000, binds to `127.0.0.1`; override with `PORT` and `PLAYGO_DEV_HOST`).

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

- `apps/web`: web frontend and separate demo preview
- `apps/api`: Node API with Deriv authentication and tests
- `services/mt5`: read-only Windows MT5 adapter
- `docs`: architecture, source audit, validation and import notes

## References

- https://developers.deriv.com/docs/intro/oauth/
- https://developers.deriv.com/docs/options/get-accounts/
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
