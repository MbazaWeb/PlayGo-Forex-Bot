-- Incremental migration. Existing paper-worker accounts require explicit qualification.
alter table public.playgo_demo_controls add column broker_demo_qualified boolean not null default false;

create function public.playgo_broker_demo_state(p_account text) returns jsonb
language sql security invoker set search_path='' as $$
select public.playgo_demo_risk_status(p_account) || jsonb_build_object(
 'qualified',coalesce((select broker_demo_qualified from public.playgo_demo_controls where account_id=p_account),false),
 'unresolved',exists(select from public.playgo_execution_intents where account_id=p_account and status in ('reserved','submitted','unknown','confirmed')),
 'tradesToday',(select count(*) from public.playgo_execution_audit a join public.playgo_execution_intents i on i.id=a.intent_id where i.account_id=p_account and a.event_type='DEMO_SUBMIT' and a.created_at>=date_trunc('day',now(),'UTC')),
 'lastTradeAt',coalesce((select extract(epoch from max(a.created_at))*1000 from public.playgo_execution_audit a join public.playgo_execution_intents i on i.id=a.intent_id where i.account_id=p_account and a.event_type='DEMO_SUBMIT'),0),
 'recentLosses',(select count(*) from (select s.cost>s.proceeds as lost from public.playgo_demo_settlements s join public.playgo_execution_intents i on i.id=s.intent_id where i.account_id=p_account order by s.sold_at desc,s.intent_id limit 3) r where lost)
);
$$;
revoke all on function public.playgo_broker_demo_state(text) from public,anon,authenticated;
grant execute on function public.playgo_broker_demo_state(text) to service_role;

create function public.playgo_check_broker_signal() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.playgo_demo_strategies%rowtype;
begin
 if left(new.strategy_id,6)<>'deriv-' or new.status not in ('reserved','submitted') then return new; end if;
 perform 1 from public.playgo_demo_controls where account_id=new.account_id and not paused and broker_demo_qualified for share;
 if not found then raise exception 'DEMO_NOT_QUALIFIED'; end if;
 select * into s from public.playgo_demo_strategies where account_id=new.account_id for share;
 if not found or not s.enabled or s.observed_minute is distinct from floor(extract(epoch from clock_timestamp())/60)::bigint*60
 or ('deriv-'||s.pack_id) is distinct from new.strategy_id
 or new.idempotency_key is distinct from (s.version::text||'_'||s.observed_minute::text)
 or (case s.signal when 'up' then 'CALL' when 'down' then 'PUT' end) is distinct from new.contract_type
 then raise exception 'STALE_DEMO_SIGNAL'; end if;
 return new;
end $$;
revoke all on function public.playgo_check_broker_signal() from public,anon,authenticated,service_role;
create trigger check_broker_signal before insert or update of status on public.playgo_execution_intents
for each row execute function public.playgo_check_broker_signal();
