create or replace function public.playgo_reserve_demo(p_record jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
 if (p_record->>'account_mode') is distinct from 'demo' or
    (p_record->>'status') is distinct from 'reserved' then
   raise exception 'INVALID_RESERVATION';
 end if;
 insert into public.playgo_execution_intents
 (account_id,account_mode,idempotency_key,strategy_id,symbol,contract_type,stake)
 values (p_record->>'account_id','demo',p_record->>'idempotency_key',
 p_record->>'strategy_id',p_record->>'symbol',p_record->>'contract_type',
 (p_record->>'stake')::numeric) returning id into v_id;
 insert into public.playgo_execution_audit(intent_id,event_type)
 values(v_id,'DEMO_INTENT_RESERVED');
 return jsonb_build_object('id',v_id,'status','reserved','audited',true);
end; $$;
revoke all on function public.playgo_reserve_demo(jsonb) from public, anon, authenticated;
grant execute on function public.playgo_reserve_demo(jsonb) to service_role;
