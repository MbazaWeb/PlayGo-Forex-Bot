-- Applied to the staging Supabase project.
-- Allow only one unresolved execution intent per account.
create unique index if not exists playgo_one_unresolved_demo_intent_per_account
on public.playgo_execution_intents(account_id)
where status in ('reserved','submitted','confirmed','unknown');

-- Preserve audit records against accidental changes.
create or replace function public.playgo_execution_audit_immutable()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'execution audit is append only'; end; $$;

drop trigger if exists playgo_execution_audit_immutable_trigger on public.playgo_execution_audit;
create trigger playgo_execution_audit_immutable_trigger
before update or delete on public.playgo_execution_audit
for each row execute function public.playgo_execution_audit_immutable();

revoke all on function public.playgo_execution_audit_immutable()
from public, anon, authenticated;
revoke update, delete, truncate on public.playgo_execution_audit from service_role;

create index if not exists playgo_execution_intents_account_status_idx
on public.playgo_execution_intents(account_id,status,created_at desc);
