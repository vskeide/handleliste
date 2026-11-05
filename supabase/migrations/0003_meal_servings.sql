-- 0003_meal_servings.sql — 2026-11-05
-- Meals get a "for how many people" number so the app can scale the ingredients to
-- the household size when a meal is added to a list. NULL = not scaled (the three
-- meals that existed before this keep working exactly as before).
--
-- Run once in Supabase → SQL Editor. Safe to run again. Nothing is deleted.

alter table public.meals
  add column if not exists servings integer check (servings is null or servings between 1 and 20);

-- RLS from 0002 stays on; new columns need no extra rules.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'meals'
order by ordinal_position;
