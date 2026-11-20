-- Server-side migration for a fail-closed demo execution audit.
create table if not exists public.playgo_execution_intents (
 id uuid primary key default gen_random_uuid(),
 idempotency_key text not null unique,
 account_id text not null,
 account_mode text not null check (account_mode = 'demo'),
 strategy_id text not null,
 symbol text not null,
 contract_type text not null,
 stake numeric(20,8) not null check (stake > 0),
 status text not null default 'reserved' check (status in ('reserved','submitted','confirmed','rejected','unknown','settled')),
 broker_contract_id text unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.playgo_execution_audit (
 id bigint generated always as identity primary key,
 intent_id uuid references public.playgo_execution_intents(id),
 event_type text not null,
 event_data jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists playgo_execution_audit_intent_idx on public.playgo_execution_audit(intent_id,created_at);
alter table public.playgo_execution_intents enable row level security;
alter table public.playgo_execution_audit enable row level security;
revoke all on public.playgo_execution_intents from anon, authenticated;
revoke all on public.playgo_execution_audit from anon, authenticated;
-- No direct browser access. Execution workers must use a separately scoped server identity.
