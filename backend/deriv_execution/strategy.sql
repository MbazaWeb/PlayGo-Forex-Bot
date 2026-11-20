create table public.playgo_demo_strategies (
 account_id text primary key,
 fast integer not null check(fast>=2),
 slow integer not null check(slow>fast and slow<=100),
 enabled boolean not null default false,
 version uuid not null default gen_random_uuid(),
 signal text check(signal in ('up','down','none','unavailable')),
 observed_minute bigint
);
alter table public.playgo_demo_strategies enable row level security;
revoke all on public.playgo_demo_strategies from public,anon,authenticated,service_role;
grant select,insert,update on public.playgo_demo_strategies to service_role;
