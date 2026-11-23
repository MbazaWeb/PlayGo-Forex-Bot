# PlayGo Trading

PlayGo Trading is a Deriv workspace for Demo and Real accounts. Bot Agents analyze live market candles and can submit authenticated Deriv Options orders when explicitly started.

## Real execution

- Select a Demo or Real Deriv Options account. The server verifies the account against the authenticated session and checks that Deriv's OTP URL matches its account type. Demo trades use virtual funds.
- Bot Agents run on the selected account while their page is open. Switching accounts or leaving the page stops monitoring that account. Selecting it again on the Bot Agents page resumes active monitoring.
- Automatic setup defaults to five-minute checks, a stop-loss target of 35% of stake, and a take-profit target of 50% of stake. It requires an 85/100 signal and skips entries during elevated relative volatility. Manual Setup allows market, interval, and exit-target overrides and uses the 75/100 signal floor. Confluence measures indicator agreement.
- Each order is limited to 1% of the current account balance, with no more than five open contracts per account.
- "Place Trade Now" performs an immediate server-side analysis and risk check; it does not bypass the signal threshold. If it places an order on an inactive account, Bot Agents stay active there for exit monitoring and later scheduled checks until stopped. Scheduled checks use the selected candle interval and run only while the signed-in Bot Agents page is open.
- Stop-loss and take-profit percentages are required and stored with each account's persistent agent control. They monitor each contract's floating P&L relative to its stake and submit best-effort sell requests; they are not broker-side guarantees. The current Deriv CALL/PUT path does not support FOK.
- The Emergency Agent pauses new orders when verified equity reaches 80% of the balance captured when the agent was first started. It then attempts to close open contracts. Broker acceptance and fills are not guaranteed, so this is not a guaranteed maximum-loss cap.
- Both account types require the execution database migration and a valid Deriv OAuth session. Real-money execution also requires `LIVE_TRADING_ENABLED=true` and `LIVE_TRADING_CONFIRM` set to the exact real account ID. Tests use mock broker responses; they never submit a real order.

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

- `frontend`: Vite application and Deriv Bot Agents
- `backend/api`: authenticated Node API and OAuth session handling
- `backend/trading`: real-account execution, risk checks, emergency controls, and database access
- `backend/deriv_execution`: database migrations for real execution
- `docs`: architecture, security, and risk-control notes
