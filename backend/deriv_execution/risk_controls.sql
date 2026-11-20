-- Apply after reserve.sql and atomic_transition.sql in an isolated demo database.
create table public.playgo_demo_controls (
 account_id text primary key,
 paused boolean not null default true
);
create table public.playgo_demo_settlements (
 intent_id uuid primary key references public.playgo_execution_intents(id),
 proceeds numeric not null check(proceeds >= 0 and proceeds < 'Infinity'::numeric),
 cost numeric not null check(cost > 0 and cost < 'Infinity'::numeric),
 sold_at timestamptz not null
);
alter table public.playgo_demo_controls enable row level security;
alter table public.playgo_demo_settlements enable row level security;
revoke all on public.playgo_demo_controls,public.playgo_demo_settlements from public,anon,authenticated,service_role;
grant select on public.playgo_demo_controls to service_role;
grant select,insert on public.playgo_demo_settlements to service_role;
-- The worker only reads the switch. Only a database operator can arm an account.
create function public.playgo_demo_paused(p_account text) returns boolean
language sql security definer set search_path='' as $$
 select paused from public.playgo_demo_controls where account_id=p_account for share
$$;
revoke all on function public.playgo_demo_paused(text) from public,anon,authenticated;
grant execute on function public.playgo_demo_paused(text) to service_role;
create function public.playgo_demo_risk_guard() returns trigger language plpgsql set search_path='' as $$
declare stopped boolean; today timestamptz := date_trunc('day',now(),'UTC');
begin
 if new.status='settled' then
   if not exists(select from public.playgo_demo_settlements where intent_id=new.id)
   then raise exception 'MISSING_SETTLEMENT'; end if;
   return new;
 end if;
 if new.status not in ('reserved','submitted') then return new; end if;
 stopped := public.playgo_demo_paused(new.account_id);
 if stopped is distinct from false then raise exception 'ACCOUNT_PAUSED'; end if;
 if new.stake>1 or not(new.stake>0) then raise exception 'STAKE_LIMIT'; end if;
 if exists(select from public.playgo_execution_intents i left join public.playgo_demo_settlements s on s.intent_id=i.id
 where i.account_id=new.account_id and i.status='settled' and s.intent_id is null)
 then raise exception 'UNVERIFIED_HISTORY'; end if;
 if (select coalesce(sum(s.proceeds-s.cost),0) from public.playgo_demo_settlements s
 join public.playgo_execution_intents i on i.id=s.intent_id where i.account_id=new.account_id and s.sold_at>=today)<=-5
 then raise exception 'DAILY_LOSS_LIMIT'; end if;
 if (select count(*) from (select s.proceeds<s.cost as lost from public.playgo_demo_settlements s
 join public.playgo_execution_intents i on i.id=s.intent_id where i.account_id=new.account_id order by s.sold_at desc,s.intent_id limit 3) recent where lost)=3
 then raise exception 'LOSS_STREAK'; end if;
 if exists(select from public.playgo_execution_audit a join public.playgo_execution_intents i on i.id=a.intent_id
 where i.account_id=new.account_id and a.event_type='DEMO_SUBMIT' and a.created_at>now()-interval '60 seconds') then raise exception 'COOLDOWN'; end if;
 if (select count(*) from public.playgo_execution_audit a join public.playgo_execution_intents i on i.id=a.intent_id
 where i.account_id=new.account_id and a.event_type='DEMO_SUBMIT' and a.created_at>=today)>=10 then raise exception 'DAILY_TRADE_LIMIT'; end if;
 return new;
end; $$;
create trigger playgo_demo_risk_guard before insert or update of status on public.playgo_execution_intents
for each row execute function public.playgo_demo_risk_guard();
revoke all on function public.playgo_demo_risk_guard() from public,anon,authenticated;
create function public.playgo_settle_bound_demo(p_intent_id uuid,p_contract_id text,p_cost numeric,p_proceeds numeric,p_sold_at bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.playgo_execution_intents%rowtype; event text;
begin
 select * into strict i from public.playgo_execution_intents where id=p_intent_id for update;
 if i.broker_contract_id is distinct from p_contract_id or p_contract_id is null or i.stake<>p_cost or
 to_timestamp(p_sold_at)>clock_timestamp() or to_timestamp(p_sold_at)<date_trunc('second',i.created_at)
 then raise exception 'SETTLEMENT_MISMATCH'; end if;
 event := case i.status when 'confirmed' then 'settle' when 'unknown' then 'reconcile_closed' end;
 if event is null then raise exception 'INVALID_SETTLEMENT_STATE'; end if;
 insert into public.playgo_demo_settlements values (i.id,p_proceeds,p_cost,to_timestamp(p_sold_at));
 return public.playgo_atomic_demo_transition(i.id,event,p_contract_id);
end; $$;
revoke all on function public.playgo_settle_bound_demo(uuid,text,numeric,numeric,bigint) from public,anon,authenticated;
grant execute on function public.playgo_settle_bound_demo(uuid,text,numeric,numeric,bigint) to service_role;
create table public.playgo_demo_worker_health (
 account_id text primary key, completed_at timestamptz not null default now()
);
alter table public.playgo_demo_worker_health enable row level security;
revoke all on public.playgo_demo_worker_health from public,anon,authenticated;
grant select,insert,update on public.playgo_demo_worker_health to service_role;
create function public.playgo_demo_risk_status(p_account text) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'paused',coalesce((select paused from public.playgo_demo_controls where account_id=p_account),true),
 'lastRecoveryAt',(select completed_at from public.playgo_demo_worker_health where account_id=p_account),
 'dailyRealizedPnl',case when exists(select from public.playgo_execution_intents i
 left join public.playgo_demo_settlements s on s.intent_id=i.id where i.account_id=p_account and i.status='settled' and s.intent_id is null)
 then null else (select coalesce(sum(s.proceeds-s.cost),0)::text from public.playgo_demo_settlements s join public.playgo_execution_intents i on i.id=s.intent_id
 where i.account_id=p_account and s.sold_at>=date_trunc('day',now(),'UTC')) end)
$$;
revoke all on function public.playgo_demo_risk_status(text) from public,anon,authenticated;
grant execute on function public.playgo_demo_risk_status(text) to service_role;
