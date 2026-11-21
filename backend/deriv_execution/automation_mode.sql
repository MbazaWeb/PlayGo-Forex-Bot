-- pack_id stores system-auto or a manual catalog ID. Preserve existing setups.
alter table public.playgo_demo_strategies add column selected_rule text;
