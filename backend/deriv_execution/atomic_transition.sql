-- Demo-only atomic transition; no broker orders are placed by this function.
create or replace function public.playgo_atomic_demo_transition(
 p_intent_id uuid, p_event text, p_contract_id text default null
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_row public.playgo_execution_intents%rowtype; v_next text;
begin
 select * into v_row from public.playgo_execution_intents
 where id=p_intent_id and account_mode='demo' for update;
 if not found then raise exception 'DEMO_INTENT_NOT_FOUND'; end if;
 v_next := case
 when v_row.status='reserved' and p_event='submit' then 'submitted'
 when v_row.status='reserved' and p_event='cancel' then 'rejected'
 when v_row.status='reserved' and p_event='uncertainty' then 'unknown'
 when v_row.status='submitted' and p_event='confirm' then 'confirmed'
 when v_row.status='submitted' and p_event='reject' then 'rejected'
 when v_row.status='submitted' and p_event='uncertainty' then 'unknown'
 when v_row.status='confirmed' and p_event='settle' then 'settled'
 when v_row.status='confirmed' and p_event='uncertainty' then 'unknown'
 when v_row.status='unknown' and p_event='reconcile_open' then 'confirmed'
 when v_row.status='unknown' and p_event='reconcile_closed' then 'settled'
 when v_row.status='unknown' and p_event='reconcile_rejected' then 'rejected'
 else null end;
 if v_next is null then raise exception 'INVALID_EXECUTION_TRANSITION'; end if;
 if p_contract_id is not null and p_contract_id !~ '^[0-9]{1,30}$'
 then raise exception 'INVALID_BROKER_CONTRACT_ID'; end if;
 if p_event in ('confirm','reconcile_open','reconcile_closed') and p_contract_id is null
 then raise exception 'BROKER_CONTRACT_ID_REQUIRED'; end if;
 if v_row.broker_contract_id is not null and p_contract_id is not null
 and v_row.broker_contract_id<>p_contract_id then
 raise exception 'BROKER_CONTRACT_MISMATCH'; end if;
 update public.playgo_execution_intents
 set status=v_next,broker_contract_id=coalesce(p_contract_id,broker_contract_id),updated_at=now()
 where id=p_intent_id;
 insert into public.playgo_execution_audit(intent_id,event_type,event_data)
 values (p_intent_id,'DEMO_'||upper(p_event),
 jsonb_build_object('from',v_row.status,'to',v_next,'broker_contract_id',p_contract_id));
 return jsonb_build_object('intentId',p_intent_id,'previous',v_row.status,'status',v_next,'audited',true);
end; $$;
revoke all on function public.playgo_atomic_demo_transition(uuid,text,text) from public,anon,authenticated;
grant execute on function public.playgo_atomic_demo_transition(uuid,text,text) to service_role;
