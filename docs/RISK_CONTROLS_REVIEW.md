# Phase 7D follow-up

This report supersedes the implementation and test status in PHASE7D_REVIEW.md. The previous release instructions still require explicit deployment approval.

Apply reserve.sql then risk_controls.sql only after verifying the existing schema, hardening and atomic transition definitions in the target staging database. The follow-up migration is single-use; its DDL must run in one transaction. No remote changes were performed. Keep broker submission disabled.

The account switch defaults to paused, including when the account has no control row. A database operator can pause an existing account or create a paused record using a parameterized statement:

    insert into public.playgo_demo_controls(account_id,paused) values ($1,true)
    on conflict(account_id) do update set paused=true;

The worker cannot arm an account. The guard checks the switch on both reservation and submission. It calculates losses using numeric posted settlement amounts and UTC broker sale dates. An old settled trade with missing accounting blocks new reservations. Operator review is required before opening a previously used account. Account limits assume one settlement currency per broker account.

The recovery worker posts the verified settlement and intent transition together and records a heartbeat after a successful recovery pass. The operations screen displays the switch, daily P&L and last recovery time. Serverless and local API entry points both use the shared reader.

77 automated tests passed. Production frontend build passed. A disposable native PostgreSQL cluster reproduced competing reservation and submission checks, disconnect rollback and restart durability. Local Chromium acceptance used fixture broker data. There is no live broker order transport in the application. The code still requires a real authenticated demo session, an isolated staging Supabase project with its actual worker role, and a complete demo-order lifecycle acceptance run. Do not enable broker submission based on the offline results.
