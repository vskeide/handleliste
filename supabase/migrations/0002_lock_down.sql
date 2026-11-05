-- 0002_lock_down.sql — 2026-11-05
-- Closes the hole where the public browser key (NEXT_PUBLIC_SUPABASE_ANON_KEY) could
-- read every table, including households.pin_hash.
--
-- After this, only the server (service-role key, which bypasses RLS) can touch tables.
-- The browser gets list data through server actions and live updates through a
-- content-free Realtime broadcast ping (see lib/hooks/use-realtime-list.ts).
--
-- Run once in Supabase → SQL Editor. Safe to run again.
-- (0001 = consolidated schema snapshot captured after 0005; see its header.)

begin;

-- 1. PIN lockout columns used by joinHousehold()
alter table public.households
  add column if not exists failed_pin_attempts integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

-- 2. Remove every existing policy on public tables (any of them may be an "allow all")
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- 3. Turn Row Level Security on for every public table. With no policies, the
--    anon and authenticated roles see nothing; service_role is unaffected.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 4. Belt and braces: no table privileges for the browser roles, now or for new tables
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

commit;

-- 5. Check: every row should show rls_on = true and policies = 0
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
