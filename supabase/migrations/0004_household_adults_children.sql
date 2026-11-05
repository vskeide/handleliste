-- 0004_household_adults_children.sql — 2026-11-05
-- Household size as adults (13+) and children, so dinners scale sensibly:
-- portions = adults + 0.5 × children. family_size is kept up to date as the head count.
--
-- Run once in Supabase → SQL Editor. Safe to run again. Nothing is deleted.

alter table public.households
  add column if not exists adults integer check (adults is null or adults between 0 and 20),
  add column if not exists children integer check (children is null or children between 0 and 20);

select id, name, family_size, adults, children from public.households;
