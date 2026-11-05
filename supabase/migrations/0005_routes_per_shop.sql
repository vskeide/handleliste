-- 0005_routes_per_shop.sql — 2026-11-05
-- Learned walking order per shop.
--   item_store_routes:    where in the trip this household picks an item in a shop
--   section_store_routes: where in the trip a section comes in a shop, per household;
--                         read together across households to give a shared layout
-- Positions are 0..1 (0 = first picked, 1 = last), kept as a moving average over
-- roughly the last 8 trips so a rearranged shop is relearnt.
--
-- Run once in Supabase → SQL Editor. Safe to run again. Nothing is deleted.

create table if not exists public.item_store_routes (
  household_id uuid not null references public.households(id) on delete cascade,
  item_id      uuid not null references public.items(id) on delete cascade,
  store_id     uuid not null references public.stores(id) on delete cascade,
  avg_pos      real not null,
  n            integer not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (household_id, item_id, store_id)
);

create table if not exists public.section_store_routes (
  store_id     uuid not null references public.stores(id) on delete cascade,
  section_id   uuid not null references public.sections(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  avg_pos      real not null,
  n            integer not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (store_id, section_id, household_id)
);

-- Same lock-down as 0002: only the server (service role) touches these
alter table public.item_store_routes enable row level security;
alter table public.section_store_routes enable row level security;
revoke all on public.item_store_routes from anon, authenticated;
revoke all on public.section_store_routes from anon, authenticated;

select table_name, (select relrowsecurity from pg_class where relname = table_name) as rls_on
from information_schema.tables
where table_schema = 'public' and table_name in ('item_store_routes', 'section_store_routes');
