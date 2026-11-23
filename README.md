# PlayGo Trading

PlayGo Trading is a real-account-only Deriv workspace. Bot Agents analyze live market candles and can submit authenticated Deriv Options orders when explicitly started.

## Real execution

- Only Deriv accounts verified by the authenticated session as `account_type: real` are returned to the trading UI or accepted by the execution adapter.
- Bot Agents run across all connected real accounts while their page is open. Leaving or closing the page stops the monitoring loop; reopening it resumes accounts that remain active.
- A qualifying setup requires a 75/100 indicator-confluence score. This is not a measured win probability.
- Each order is limited to 1% of the current account balance, with no more than five open contracts per account.
- "Place Trade Now" performs an immediate server-side analysis and risk check; it does not bypass the signal threshold. If it places an order on an inactive account, Bot Agents stay active there for exit monitoring and later scheduled checks until stopped. Scheduled checks use the selected candle interval and run only while the signed-in Bot Agents page is open.
- Stop-loss and take-profit percentages are required and stored with each account's persistent agent control. They monitor each contract's floating P&L relative to its stake and submit best-effort sell requests; they are not broker-side guarantees. The current Deriv CALL/PUT path does not support FOK.
- The Emergency Agent pauses new orders when verified equity reaches 80% of the balance captured when the agent was first started. It then attempts to close open contracts. Broker acceptance and fills are not guaranteed, so this is not a guaranteed maximum-loss cap.
- Starting Bot Agents requires `LIVE_TRADING_ENABLED=true`, the real-execution database migration, a valid Deriv OAuth session, and a real account. Tests use mock broker responses; they never submit a real order.

The database migration is [real_execution.sql](./backend/deriv_execution/real_execution.sql). Apply it only to the intended database after reviewing it. Do not apply it to a hosted database as part of local development.

## Local setup

Requires Node.js 22+.

```bash
npm install
npm test
npm run build
npm run verify:execution
```

Configure Deriv OAuth and a server-only database worker identity in `.env`. Use a local PostgREST/PostgreSQL instance for development. Keep credentials out of browser variables and source control; never commit `.env`.

```bash
npm run dev
```

Open http://localhost:5173. For Vercel development, run `node backend/api/src/vercel-dev-server.js`.

## Project layout

- `frontend`: Vite application and real-account Bot Agents
- `backend/api`: authenticated Node API and OAuth session handling
- `backend/trading`: real-account execution, risk checks, emergency controls, and database access
- `backend/deriv_execution`: database migrations for real execution
- `docs`: architecture, security, and risk-control notes
