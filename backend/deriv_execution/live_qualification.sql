-- Server-owned evidence. The execution role can only read approved records.
create table if not exists public.playgo_live_qualification (
  account_id text primary key,
  approved_by text not null check (length(trim(approved_by)) > 0),
  approved_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > approved_at),
  holdout_start bigint not null,
  settlements jsonb not null check (
    jsonb_typeof(settlements) = 'array' and jsonb_array_length(settlements) between 500 and 10000
  )
);
alter table public.playgo_live_qualification enable row level security;
revoke all on public.playgo_live_qualification from public, anon, authenticated, service_role;
grant select on public.playgo_live_qualification to service_role;
