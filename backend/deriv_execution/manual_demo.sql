create or replace function public.playgo_check_broker_signal() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.playgo_demo_strategies%rowtype;
begin
 if left(new.strategy_id,6)<>'deriv-' or new.status not in ('reserved','submitted') then return new; end if;
 perform 1 from public.playgo_demo_controls where account_id=new.account_id and not paused and broker_demo_qualified for share;
 if not found then raise exception 'DEMO_NOT_QUALIFIED'; end if;
 -- Manual tickets carry a distinct namespace and do not consume strategy signals.
 if new.strategy_id='deriv-manual-ticket' then
   if new.idempotency_key !~ '^manual_[0-9a-f-]{36}$' then raise exception 'INVALID_MANUAL_KEY'; end if;
   return new;
 end if;
 select * into s from public.playgo_demo_strategies where account_id=new.account_id for share;
 if not found or not s.enabled or s.observed_minute is distinct from floor(extract(epoch from clock_timestamp())/60)::bigint*60
 or ('deriv-'||s.pack_id) is distinct from new.strategy_id
 or new.idempotency_key is distinct from (s.version::text||'_'||s.observed_minute::text)
 or (case s.signal when 'up' then 'CALL' when 'down' then 'PUT' end) is distinct from new.contract_type
 then raise exception 'STALE_DEMO_SIGNAL'; end if;
 return new;
end $$;
revoke all on function public.playgo_check_broker_signal() from public,anon,authenticated,service_role;
