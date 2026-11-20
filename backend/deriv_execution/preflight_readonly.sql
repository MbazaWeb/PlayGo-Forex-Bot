-- Read-only checks. Run before applying atomic_transition.sql.
select column_name,data_type,is_nullable from information_schema.columns
 where table_schema='public' and table_name='playgo_execution_intents'
 order by ordinal_position;
select column_name,data_type,is_nullable from information_schema.columns
 where table_schema='public' and table_name='playgo_execution_audit'
 order by ordinal_position;
select indexname,indexdef from pg_indexes where schemaname='public'
 and tablename='playgo_execution_intents';
select tgname from pg_trigger where tgrelid='public.playgo_execution_audit'::regclass and not tgisinternal;
select to_regprocedure('public.playgo_atomic_demo_transition(uuid,text,text)') as installed_rpc;
