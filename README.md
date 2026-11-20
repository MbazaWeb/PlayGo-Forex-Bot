# PlayGo Trading

PlayGo Trading is a React/Vite trading workspace with a Node API for Deriv OAuth2/PKCE and an isolated, read-only MetaTrader 5 adapter.

## Features

- Deriv OAuth authorization-code + PKCE login and secure server-side session handling
- Deriv Options account retrieval (configuration and broker testing required)
- React/Vite frontend with a separately labeled simulated trading workspace
- Windows MT5 read-only snapshot adapter (not connected to the API)
- API authentication regression tests

**Not implemented:** live order execution, actual bot automation, broker-backed market charts, persistent sessions, MT5 account linking, account reconciliation, or server-side risk controls. All demo performance and preview charts are simulated.

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
npm run server
npm run dev
```

Open http://localhost:5173.

Deriv callback: `http://localhost:5173/api/auth/deriv/callback`. Production uses a same-origin HTTPS callback and a single Node backend because sessions are currently process-local. Review `docs/ARCHITECTURE.md` before deployment. **Never commit `.env`, access tokens, API secrets, or MT5 credentials.**

The original `package-lock.json` was not transferred during the GitHub import. See `docs/REPOSITORY_STATUS.md` and run `npm install` to regenerate it locally.

## Project layout

- `apps/web`: web frontend and separate demo preview
- `apps/api`: Node API with Deriv authentication and tests
- `services/mt5`: read-only Windows MT5 adapter
- `docs`: architecture, source audit, validation and import notes

## References

- https://developers.deriv.com/docs/intro/oauth/
- https://developers.deriv.com/docs/options/get-accounts/
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
