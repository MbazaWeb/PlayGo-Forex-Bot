create table if not exists public.playgo_real_controls (
  account_id text primary key,
  starting_balance numeric not null check (starting_balance > 0 and starting_balance < 'Infinity'::numeric),
  active boolean not null default false,
  paused boolean not null default false,
  stop_reason text,
  stop_loss_percent numeric,
  take_profit_percent numeric,
  constraint playgo_real_controls_exit_settings_check check (
    (stop_loss_percent is null and take_profit_percent is null) or
    (
      stop_loss_percent is not null and stop_loss_percent > 0 and stop_loss_percent <= 100 and
      take_profit_percent is not null and take_profit_percent > 0 and take_profit_percent <= 10000
    )
  ),
  updated_at timestamptz not null default now()
);

alter table public.playgo_real_controls
  add column if not exists stop_loss_percent numeric;
alter table public.playgo_real_controls
  add column if not exists take_profit_percent numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.playgo_real_controls'::regclass
      and conname = 'playgo_real_controls_exit_settings_check'
  ) then
    alter table public.playgo_real_controls
      add constraint playgo_real_controls_exit_settings_check check (
        (stop_loss_percent is null and take_profit_percent is null) or
        (
          stop_loss_percent is not null and stop_loss_percent > 0 and stop_loss_percent <= 100 and
          take_profit_percent is not null and take_profit_percent > 0 and take_profit_percent <= 10000
        )
      );
  end if;
end
$$;

create table if not exists public.playgo_real_intents (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.playgo_real_controls(account_id),
  idempotency_key text not null unique,
  symbol text not null,
  contract_type text not null check (contract_type in ('CALL', 'PUT')),
  stake numeric not null check (stake > 0 and stake < 'Infinity'::numeric),
  duration integer not null check (duration between 1 and 60),
  status text not null default 'reserved'
    check (status in ('reserved', 'submitted', 'confirmed', 'rejected', 'unknown')),
  broker_contract_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.playgo_real_audit (
  id bigint generated always as identity primary key,
  account_id text not null,
  intent_id uuid references public.playgo_real_intents(id),
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists playgo_real_audit_account_idx
  on public.playgo_real_audit(account_id, created_at desc);
create index if not exists playgo_real_intents_account_status_idx
  on public.playgo_real_intents(account_id, status);

alter table public.playgo_real_controls enable row level security;
alter table public.playgo_real_intents enable row level security;
alter table public.playgo_real_audit enable row level security;

revoke all on public.playgo_real_controls from public, anon, authenticated;
revoke all on public.playgo_real_intents from public, anon, authenticated;
revoke all on public.playgo_real_audit from public, anon, authenticated;
grant select, insert, update on public.playgo_real_controls to service_role;
grant select, insert, update on public.playgo_real_intents to service_role;
grant select, insert on public.playgo_real_audit to service_role;
grant usage on sequence public.playgo_real_audit_id_seq to service_role;

create or replace function public.playgo_real_start_control(p_account_id text, p_balance numeric)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare row_data public.playgo_real_controls%rowtype;
begin
  if p_account_id !~ '^[A-Za-z0-9_-]{3,80}$' or p_balance is null or
     p_balance <= 0 or p_balance >= 'Infinity'::numeric then
    raise exception 'INVALID_REAL_ACCOUNT';
  end if;

  insert into public.playgo_real_controls(account_id, starting_balance, active, paused)
  values (p_account_id, p_balance, true, false)
  on conflict (account_id) do nothing;

  select * into strict row_data
  from public.playgo_real_controls
  where account_id = p_account_id
  for update;

  if row_data.paused then
    return jsonb_build_object('active', false, 'paused', true, 'reason', row_data.stop_reason);
  end if;

  update public.playgo_real_controls
  set active = true, updated_at = now()
  where account_id = p_account_id
  returning * into row_data;

  insert into public.playgo_real_audit(account_id, event_type)
  values (p_account_id, 'AGENT_STARTED');

  return jsonb_build_object(
    'active', row_data.active,
    'paused', row_data.paused,
    'startingBalance', row_data.starting_balance
  );
end;
$$;

create or replace function public.playgo_real_configure_control(
  p_account_id text,
  p_balance numeric,
  p_stop_loss_percent numeric,
  p_take_profit_percent numeric
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare row_data public.playgo_real_controls%rowtype;
begin
  if p_account_id !~ '^[A-Za-z0-9_-]{3,80}$' or p_balance is null or
     p_balance <= 0 or p_balance >= 'Infinity'::numeric or
     p_stop_loss_percent is null or p_stop_loss_percent <= 0 or p_stop_loss_percent > 100 or
     p_take_profit_percent is null or p_take_profit_percent <= 0 or p_take_profit_percent > 10000 then
    raise exception 'INVALID_REAL_AGENT_CONFIGURATION';
  end if;

  insert into public.playgo_real_controls(
    account_id, starting_balance, active, paused, stop_loss_percent, take_profit_percent
  )
  values (
    p_account_id, p_balance, true, false, p_stop_loss_percent, p_take_profit_percent
  )
  on conflict (account_id) do nothing;

  select * into strict row_data
  from public.playgo_real_controls
  where account_id = p_account_id
  for update;

  if row_data.paused then
    return jsonb_build_object(
      'active', false,
      'paused', true,
      'reason', row_data.stop_reason,
      'stopLossPercent', row_data.stop_loss_percent,
      'takeProfitPercent', row_data.take_profit_percent
    );
  end if;

  update public.playgo_real_controls
  set active = true,
      stop_loss_percent = p_stop_loss_percent,
      take_profit_percent = p_take_profit_percent,
      updated_at = now()
  where account_id = p_account_id
  returning * into row_data;

  insert into public.playgo_real_audit(account_id, event_type, event_data)
  values (
    p_account_id,
    'AGENT_CONFIGURED',
    jsonb_build_object(
      'stop_loss_percent', p_stop_loss_percent,
      'take_profit_percent', p_take_profit_percent
    )
  );

  return jsonb_build_object(
    'active', row_data.active,
    'paused', row_data.paused,
    'startingBalance', row_data.starting_balance,
    'stopLossPercent', row_data.stop_loss_percent,
    'takeProfitPercent', row_data.take_profit_percent
  );
end;
$$;

create or replace function public.playgo_real_stop_control(p_account_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.playgo_real_controls
  set active = false, updated_at = now()
  where account_id = p_account_id and not paused;
  get diagnostics changed = row_count;
  if changed = 0 and not exists (
    select 1 from public.playgo_real_controls where account_id = p_account_id
  ) then
    raise exception 'REAL_CONTROL_NOT_FOUND';
  end if;
  insert into public.playgo_real_audit(account_id, event_type)
  values (p_account_id, 'AGENT_STOPPED');
  return jsonb_build_object('active', false);
end;
$$;

create or replace function public.playgo_real_pause_control(p_account_id text, p_reason text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if p_reason not in ('DRAWDOWN_LIMIT', 'ORDER_OUTCOME_UNKNOWN') then
    raise exception 'INVALID_PAUSE_REASON';
  end if;
  update public.playgo_real_controls
  set active = false, paused = true, stop_reason = p_reason, updated_at = now()
  where account_id = p_account_id;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'REAL_CONTROL_NOT_FOUND'; end if;
  insert into public.playgo_real_audit(account_id, event_type, event_data)
  values (p_account_id, 'EMERGENCY_PAUSE', jsonb_build_object('reason', p_reason));
  return jsonb_build_object('active', false, 'paused', true, 'reason', p_reason);
end;
$$;

create or replace function public.playgo_real_reserve_intent(p_record jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  account text := p_record->>'account_id';
  balance numeric := (p_record->>'balance')::numeric;
  equity numeric := (p_record->>'equity')::numeric;
  open_count integer := (p_record->>'open_count')::integer;
  snapshot_started_at timestamptz := (p_record->>'portfolio_snapshot_started_at')::timestamptz;
  stake_value numeric := (p_record->>'stake')::numeric;
  control public.playgo_real_controls%rowtype;
  intent_id uuid;
begin
  if account is null or account !~ '^[A-Za-z0-9_-]{3,80}$' or
     balance is null or balance <= 0 or balance >= 'Infinity'::numeric or
     equity is null or equity < 0 or equity >= 'Infinity'::numeric or
     open_count is null or open_count < 0 or
     stake_value is null or stake_value <= 0 or stake_value >= 'Infinity'::numeric or
     p_record->>'status' is distinct from 'reserved' or
     p_record->>'symbol' !~ '^[A-Za-z0-9_]{2,30}$' or
     p_record->>'contract_type' not in ('CALL', 'PUT') or
     (p_record->>'duration')::integer not between 1 and 60 or
     p_record->>'idempotency_key' !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_REAL_RESERVATION';
  end if;

  select * into control
  from public.playgo_real_controls
  where account_id = account
  for update;
  if not found then raise exception 'REAL_AGENT_NOT_STARTED'; end if;
  if control.paused or not control.active then
    return jsonb_build_object('accepted', false, 'reason', 'AGENT_NOT_ACTIVE');
  end if;

  if equity <= control.starting_balance * 0.90 then
    update public.playgo_real_controls
    set active = false, paused = true, stop_reason = 'DRAWDOWN_LIMIT', updated_at = now()
    where account_id = account;
    insert into public.playgo_real_audit(account_id, event_type, event_data)
    values (account, 'EMERGENCY_PAUSE', jsonb_build_object('reason', 'DRAWDOWN_LIMIT', 'equity', equity));
    return jsonb_build_object('accepted', false, 'reason', 'DRAWDOWN_LIMIT');
  end if;

  if stake_value > balance * 0.01 then
    return jsonb_build_object('accepted', false, 'reason', 'STAKE_LIMIT');
  end if;

  -- Count recent confirmations conservatively when concurrent requests read the same portfolio.
  if snapshot_started_at is not null then
    select open_count + count(*) into open_count
    from public.playgo_real_intents
    where account_id = account and status = 'confirmed' and updated_at >= snapshot_started_at;
  end if;

  if open_count >= 2 then
    return jsonb_build_object('accepted', false, 'reason', 'OPEN_CONTRACT_LIMIT');
  end if;

  if exists (
    select 1 from public.playgo_real_intents
    where account_id = account and status in ('reserved', 'submitted', 'unknown')
  ) then
    return jsonb_build_object('accepted', false, 'reason', 'UNKNOWN_ORDER_STATE');
  end if;

  insert into public.playgo_real_intents(
    account_id, idempotency_key, symbol, contract_type, stake, duration
  )
  values (
    account, p_record->>'idempotency_key', p_record->>'symbol',
    p_record->>'contract_type', stake_value, (p_record->>'duration')::integer
  )
  on conflict (idempotency_key) do nothing
  returning id into intent_id;

  if intent_id is null then
    return jsonb_build_object('accepted', false, 'reason', 'DUPLICATE_SIGNAL');
  end if;

  insert into public.playgo_real_audit(account_id, intent_id, event_type)
  values (account, intent_id, 'INTENT_RESERVED');
  return jsonb_build_object('accepted', true, 'intentId', intent_id, 'status', 'reserved');
end;
$$;

create or replace function public.playgo_real_transition(
  p_intent_id uuid,
  p_event text,
  p_contract_id text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  intent public.playgo_real_intents%rowtype;
  next_status text;
begin
  select * into strict intent
  from public.playgo_real_intents
  where id = p_intent_id
  for update;

  next_status := case
    when intent.status = 'reserved' and p_event = 'submit' then 'submitted'
    when intent.status = 'reserved' and p_event = 'reject' then 'rejected'
    when intent.status = 'submitted' and p_event = 'confirm' then 'confirmed'
    when intent.status = 'submitted' and p_event = 'reject' then 'rejected'
    when intent.status = 'submitted' and p_event = 'unknown' then 'unknown'
    else null
  end;
  if next_status is null then raise exception 'INVALID_REAL_TRANSITION'; end if;

  if p_event = 'confirm' and
     (p_contract_id is null or p_contract_id !~ '^[0-9]{1,30}$') then
    raise exception 'INVALID_BROKER_CONTRACT_ID';
  end if;

  update public.playgo_real_intents
  set status = next_status,
      broker_contract_id = coalesce(p_contract_id, broker_contract_id),
      updated_at = now()
  where id = p_intent_id;

  insert into public.playgo_real_audit(account_id, intent_id, event_type, event_data)
  values (intent.account_id, p_intent_id, 'ORDER_' || upper(p_event),
    jsonb_build_object('from', intent.status, 'to', next_status, 'contract_id', p_contract_id));

  if next_status = 'unknown' then
    update public.playgo_real_controls
    set active = false, paused = true, stop_reason = 'ORDER_OUTCOME_UNKNOWN', updated_at = now()
    where account_id = intent.account_id;
  end if;

  return jsonb_build_object('intentId', p_intent_id, 'status', next_status);
end;
$$;

revoke all on function public.playgo_real_start_control(text, numeric) from public, anon, authenticated;
revoke all on function public.playgo_real_configure_control(text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.playgo_real_stop_control(text) from public, anon, authenticated;
revoke all on function public.playgo_real_pause_control(text, text) from public, anon, authenticated;
revoke all on function public.playgo_real_reserve_intent(jsonb) from public, anon, authenticated;
revoke all on function public.playgo_real_transition(uuid, text, text) from public, anon, authenticated;
grant execute on function public.playgo_real_start_control(text, numeric) to service_role;
grant execute on function public.playgo_real_configure_control(text, numeric, numeric, numeric) to service_role;
grant execute on function public.playgo_real_stop_control(text) to service_role;
grant execute on function public.playgo_real_pause_control(text, text) to service_role;
grant execute on function public.playgo_real_reserve_intent(jsonb) to service_role;
grant execute on function public.playgo_real_transition(uuid, text, text) to service_role;
