-- Read-only schema capture through the Supabase connector execute_sql tool.
-- Returns DDL, never table contents. Order matters: referenced keys precede FKs.
-- Wrap returned SQL in a transaction with search_path = public, extensions, pg_catalog.
-- Also retain extension setup and the access/default-privilege footer in 0001_baseline.sql.
with tables as (
 select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r'
), ddl as (
 select 10 as phase, t.relname as name, format('CREATE TABLE IF NOT EXISTS public.%I (%s%s%s);',t.relname,chr(10),
  (select string_agg(format('  %I %s%s%s',a.attname,format_type(a.atttypid,a.atttypmod),
    case when d.adbin is not null then ' DEFAULT '||pg_get_expr(d.adbin,d.adrelid) else '' end,
    case when a.attnotnull then ' NOT NULL' else '' end),','||chr(10) order by a.attnum)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),chr(10)) as sql from tables t
 union all
 select case when c.contype = 'f' then 25 else 20 end,t.relname::text||'.'||c.conname::text,
 format('DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = %L::regclass AND conname = %L) THEN ALTER TABLE public.%I ADD CONSTRAINT %I %s; END IF; END $baseline$;', 'public.'||quote_ident(t.relname),c.conname,t.relname,c.conname,pg_get_constraintdef(c.oid,true))
 from tables t join pg_constraint c on c.conrelid=t.oid where c.contype in ('p','u','c','f','x')
 union all
 select 30,i.indexname,regexp_replace(i.indexdef,'^CREATE (UNIQUE )?INDEX ', E'CREATE \\1INDEX IF NOT EXISTS ')||';' from pg_indexes i
 where i.schemaname='public' and not exists(select 1 from pg_constraint c where c.conindid=('public.'||quote_ident(i.indexname))::regclass)
 union all
 select 40,p.proname,pg_get_functiondef(p.oid)||';' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 union all
 select 50,t.relname||'.'||g.tgname,
 format('DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = %L::regclass AND tgname = %L) THEN %s; END IF; END $baseline$;', 'public.'||quote_ident(t.relname),g.tgname,pg_get_triggerdef(g.oid))
 from tables t join pg_trigger g on g.tgrelid=t.oid where not g.tgisinternal
 union all
 select 60,t.relname,format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;',t.relname) from tables t where t.relrowsecurity
)
select phase,name,sql from ddl order by phase,name;
