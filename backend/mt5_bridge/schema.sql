-- Run in the Supabase SQL editor. Service-role-only storage for single-owner MT5 demo snapshots.
create table if not exists public.playgo_mt5_snapshots (
  id text primary key,
  account_login bigint not null,
  account_server text not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  snapshot jsonb not null
);
alter table public.playgo_mt5_snapshots enable row level security;
revoke all on public.playgo_mt5_snapshots from anon, authenticated;
-- No client-side RLS policies: only the backend service role may read/write.
