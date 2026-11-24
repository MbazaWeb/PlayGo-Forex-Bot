# Account and execution architecture

## Authentication and account routing

The browser calls the same-origin Node API. The API performs Deriv OAuth2/PKCE and keeps the access token in the server session (memory locally or sealed in the server-side Vercel session cookie). The token is not returned to frontend code or persisted in the execution database.

Every trading request obtains the account list using that authenticated token. The server resolves the selected account ID to an exact `demo` or `real` record and scopes every agent action to that account. The browser cannot supply a token or override the account type.

## Bot Agents lifecycle

The signed-in user explicitly starts Bot Agents for the selected Deriv account. Scheduled checks use the selected market interval while the page is open. Place Trade Now performs the same server-side candle analysis and risk checks; if it places a contract, that account's Bot Agents remain active for exit monitoring and later scheduled checks. If no trade is placed, a control started only for the one-time check is returned to inactive. A qualifying 75/100 confluence score is required before an order can be reserved.

The persistent control row records the account's starting balance on its first start and preserves that baseline across ordinary stop/start actions. It also stores the stop-loss and take-profit percentages of stake; status reads hydrate the page after reload, and scheduled checks use the stored values rather than caller-supplied settings. A one-time request cannot overwrite configured settings on an active control. Stake is automatically 1% of the latest verified account balance, capped at $20 for USD accounts. The server verifies each open contract's buy price and floating P&L; when a threshold is reached it sends a best-effort sell request and does not open another position in that same check.

Reservation is performed transactionally: the database locks the account control row, checks the active/pause state, 1% stake bound, two-contract limit, idempotency key, and verified equity threshold, then writes an intent and audit entry before broker submission.

Order submission uses an authenticated Deriv Options OTP endpoint that must match the selected account type. It requests a live proposal and buys at no more than the quoted price; the current CALL/PUT path does not support a fill-or-kill policy or broker-side stop-loss/take-profit. The intent is marked submitted before the buy request. Ambiguous broker outcomes pause the account rather than retrying a potentially successful order.

## Emergency Agent

Before each new order, the Emergency Agent reads open contracts and verified floating P&L. Equity is current balance plus open-contract P&L. At or below 90% of the stored starting balance, it persists a paused state before requesting sells for all open contract IDs. While the Bot Agents page remains open, later checks retry closing contracts still reported open.

The monitoring loop is page-active only. If the selected account, page, or session changes, monitoring stops until the user signs in and opens Bot Agents again. Sell requests are best-effort; neither execution nor a 10% maximum loss is guaranteed.

## Database boundaries

`backend/deriv_execution/real_execution.sql` creates the service-only real control, intent, and audit tables and RPC functions. RLS is enabled; browser roles receive no table or function access. The API uses a server-only worker identity. The migration is not automatically applied to hosted databases.
