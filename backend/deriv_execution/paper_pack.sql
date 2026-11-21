-- One-minute EUR/USD paper trades, scoped to the authenticated demo account.
alter table public.playgo_demo_strategies
  add column pack_id text,
  add column bar_open numeric,
  add column bar_close numeric,
  add column paper_trades bigint not null default 0,
  add column paper_pnl numeric not null default 0,
  add column last_paper_trade jsonb;

create table public.playgo_pack_trades (
  account_id text not null references public.playgo_demo_strategies(account_id),
  bar_end bigint not null,
  strategy_id text not null,
  direction text not null check (direction in ('up','down')),
  entry numeric not null check (entry>0),
  exit numeric not null check (exit>0),
  units integer not null check (units=100),
  pnl numeric not null,
  primary key(account_id,bar_end)
);
alter table public.playgo_pack_trades enable row level security;
revoke all on public.playgo_pack_trades from public, anon, authenticated, service_role;
grant select on public.playgo_pack_trades to service_role;

create function public.playgo_record_pack_fill() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare gain numeric;
begin
  if new.pack_id is null or new.pack_id is distinct from old.pack_id or
     new.version<>old.version or not (new.enabled and old.enabled) or
     old.signal is null or old.signal not in ('up','down') or
     new.signal is null or new.signal='unavailable' or
     old.observed_minute is null or new.observed_minute is distinct from old.observed_minute+60 or
     new.bar_open is null or new.bar_close is null or
     not(new.bar_open>0 and new.bar_open<=10 and new.bar_close>0 and new.bar_close<=10) then
    return new;
  end if;
  -- A signal on the previous closed bar enters on this bar's open and exits at its close.
  -- No missed bars are replayed. The worker's versioned update serializes concurrent passes.
  if exists(select 1 from public.playgo_pack_trades where account_id=new.account_id
            and bar_end>=new.observed_minute-86400
            and bar_end-(bar_end%86400)=new.observed_minute-(new.observed_minute%86400)
            group by account_id having sum(pnl)<=-200) then return new; end if;
  gain=round((new.bar_close-new.bar_open)*100*(case old.signal when 'up' then 1 else -1 end),6);
  insert into public.playgo_pack_trades values
    (new.account_id,new.observed_minute,new.pack_id,old.signal,new.bar_open,new.bar_close,100,gain);
  new.paper_trades=old.paper_trades+1;
  new.paper_pnl=old.paper_pnl+gain;
  new.last_paper_trade=jsonb_build_object('direction',old.signal,'entry',new.bar_open,'exit',new.bar_close,
    'pnl',gain,'bar_end',new.observed_minute,'strategy',new.pack_id);
  return new;
end $$;
revoke all on function public.playgo_record_pack_fill() from public,anon,authenticated,service_role;
create trigger record_paper_fill before update on public.playgo_demo_strategies
for each row execute function public.playgo_record_pack_fill();
