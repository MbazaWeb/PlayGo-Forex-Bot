# PlayGo Trading

PlayGo Trading is a Deriv workspace for Demo and Real accounts. Bot Agents analyze live market candles and can submit authenticated Deriv Options orders when explicitly started.

## Real execution

- Select a Demo or Real Deriv Options account. The server verifies the account against the authenticated session and checks that Deriv's OTP URL matches its account type. Demo trades use virtual funds.
- One server-confirmed account is shared across the app. Account IDs are masked in the UI and API; selecting a Real account requires explicit confirmation, and switching is blocked until the current account has no open positions.
- Bot Agents run on the selected account while their page is open. Demo auto-start is on unless explicitly disabled for that account. Real auto-start is off until explicitly enabled with confirmation.
- Automatic setup defaults to five-minute checks, a stop-loss target of 35% of stake, and a take-profit target of 50% of stake. It requires an 85/100 signal and skips entries during elevated relative volatility. Manual Setup allows market, interval, and exit-target overrides and uses the 75/100 signal floor. Confluence measures indicator agreement.
- Every order mode, including manual terminal orders, is limited to 1% of the current balance and a shared $10 USD-equivalent cap, with no more than two open contracts per account. Non-USD orders require a valid Deriv exchange rate; they are blocked when it is unavailable.
- Daily settled losses are capped at 3% of the starting balance.
- "Place Trade Now" performs an immediate server-side analysis and risk check; it does not bypass the signal threshold. If it places an order on an inactive account, Bot Agents stay active there for exit monitoring and later scheduled checks until stopped. Scheduled checks use the selected candle interval and run only while the signed-in Bot Agents page is open.
- Manual terminal Buy/Sell may bypass bot signal qualification only; live-account, persistence, and risk checks still apply. Stop-loss and take-profit percentages are early-exit requests based on floating P&L, not broker-side guarantees. Deriv may not offer early sale, so the full stake can be lost. The current CALL/PUT path does not support FOK.
- The Emergency Agent pauses new orders when verified equity reaches 90% of the balance captured when the agent was first started. It then attempts to close open contracts. Broker acceptance and fills are not guaranteed, so this is not a guaranteed maximum-loss cap.
- Both account types require the execution database migration and a valid Deriv OAuth session. Real buys also require both live keys, separately logged human approval and verified settlement qualification. Tests use mocked broker responses.

The database migration is [real_execution.sql](./backend/deriv_execution/real_execution.sql). It adds account auto-start preferences, stake-cap enforcement, and order/settlement/close evidence. Apply it only to the intended database after reviewing it; this repository does not apply it to a hosted database. Do not enable the new database-backed behavior until the migration is applied.

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
- `frontend/src/agents`: dedicated UI and analysis modules for risk, strategies, reminders, account/finance, emergency controls, and trade agents
- `backend/api`: authenticated Node API and OAuth session handling
- `backend/trading`: real-account execution, risk checks, emergency controls, and database access
- `backend/trading/agents`: account validation, risk policy, emergency checks, and trade-agent orchestration
- `backend/deriv_execution`: database migrations for real execution
- `docs`: architecture, security, and risk-control notes
