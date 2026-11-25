# Account and execution architecture

## Authentication and account routing

The browser calls the same-origin Node API. The API performs Deriv OAuth2/PKCE and keeps the access token in the server session (memory locally or sealed in the server-side Vercel session cookie). The token is not returned to frontend code or persisted in the execution database.

Every trading request obtains the account list using that authenticated token. The session holds one server-confirmed active account, represented in the browser by an opaque reference and masked label. Selecting a real account requires confirmation and is audited; switching is rejected if the current account's positions cannot be verified or any are still open. Requests cannot supply a per-route account override or change the account type.

## Bot Agents lifecycle

The signed-in user explicitly starts Bot Agents for the selected Deriv account. Per-account auto-start is opt-in and disabled by default; real-account auto-start requires confirmation. Scheduled checks use the selected market interval while the page is open. Place Trade Now performs the same server-side candle analysis and risk checks; if it places a contract, that account's Bot Agents remain active for exit monitoring and later scheduled checks. If no trade is placed, a control started only for the one-time check is returned to inactive. A qualifying 75/100 confluence score is required before a signal-driven order can be reserved.

The persistent control row records the account's starting balance on its first start and preserves that baseline across ordinary stop/start actions. It also stores the stop-loss and take-profit percentages of stake; status reads hydrate the page after reload, and scheduled checks use the stored values rather than caller-supplied settings. A one-time request cannot overwrite configured settings on an active control. All order modes use server-side sizing capped at 1% of the latest verified balance and $10 USD-equivalent; non-USD orders fail closed without a valid exchange rate. The server verifies each open contract's buy price and floating P&L; thresholds trigger best-effort sell requests and do not guarantee a maximum loss.

Reservation is performed transactionally: the database locks the account control row, checks the active/pause state, 1% stake bound, caller-supplied stake cap, two-contract limit, idempotency key, and verified equity threshold, then writes strategy/technical intent evidence before broker submission. Manual terminal Buy/Sell may skip signal qualification but still goes through these live, persistence, and risk gates.

Order submission uses an authenticated Deriv Options OTP endpoint that must match the selected account type. It requests a live proposal and buys at no more than the quoted price; the current CALL/PUT path does not support a fill-or-kill policy or broker-side stop-loss/take-profit. The intent is marked submitted before the buy request, and buy transaction ID, settlement transaction ID, and buy/sell prices are stored separately when supplied. Ambiguous broker outcomes pause the account rather than retrying a potentially successful order. Close requests are checked against broker contract status; unconfirmed closes remain unresolved instead of being recorded as losses. This evidence improves reconciliation but does not itself constitute an independently verified broker statement match.

## Emergency Agent

Before each new order, the Emergency Agent reads open contracts and verified floating P&L. Equity is current balance plus open-contract P&L. At or below 90% of the stored starting balance, it persists a paused state before requesting sells for all open contract IDs. While the Bot Agents page remains open, later checks retry closing contracts still reported open.

The monitoring loop is page-active only. If the selected account, page, or session changes, monitoring stops until the user signs in and opens Bot Agents again. Sell requests are best-effort; neither execution nor a 10% maximum loss is guaranteed.

## Database boundaries

`backend/deriv_execution/real_execution.sql` creates the service-only control, intent, audit, and per-account settings tables and RPC functions. RLS is enabled; browser roles receive no table or function access. The API uses a server-only worker identity. The migration is not automatically applied to hosted databases; the operator must apply it before relying on the database-backed Phase 2 features.
