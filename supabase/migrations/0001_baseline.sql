-- 0001_baseline.sql — captured from the live public schema on 2026-11-05.
-- Schema only: no household rows, PIN hashes, keys, shops or section seed data.
-- This is a consolidated snapshot THROUGH 0005, not the original March schema.
-- On a NEW Supabase database, run this first, then 0002–0005 (idempotent).
-- Do not apply this snapshot as a new production migration: production already has it.
-- Supabase-managed schemas, roles, extensions, publication settings and migration
-- history are outside this app schema snapshot. Shared sections/shops need separate seeds.
-- Captured objects: 16 tables, 54 constraints, 31 indexes (21 constraint-backed),
-- 1 trigger function, 3 triggers. All 16 tables use server-only access.
-- CREATE IF NOT EXISTS guards allow replays; they do not repair divergent schemas.
-- Capture query: scripts/export-schema.sql. No pg_dump/DB password was needed.

BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

-- Tables
CREATE TABLE IF NOT EXISTS public.default_store_layouts (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  store_id uuid NOT NULL,
  section_id uuid NOT NULL,
  walk_order integer NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  created_by_household_id uuid
);

CREATE TABLE IF NOT EXISTS public.household_store_layouts (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  household_id uuid NOT NULL,
  store_id uuid NOT NULL,
  section_id uuid NOT NULL,
  walk_order integer NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.household_stores (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  household_id uuid NOT NULL,
  store_id uuid NOT NULL,
  is_favorite boolean DEFAULT false,
  added_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.households (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  name text DEFAULT 'Min husstand'::text NOT NULL,
  pin_hash text NOT NULL,
  household_code text NOT NULL,
  family_size integer DEFAULT 2,
  is_admin boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  failed_pin_attempts integer DEFAULT 0 NOT NULL,
  pin_locked_until timestamp with time zone,
  adults integer,
  children integer
);

CREATE TABLE IF NOT EXISTS public.item_store_routes (
  household_id uuid NOT NULL,
  item_id uuid NOT NULL,
  store_id uuid NOT NULL,
  avg_pos real NOT NULL,
  n integer DEFAULT 1 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  household_id uuid NOT NULL,
  name text NOT NULL,
  section_id uuid,
  times_purchased integer DEFAULT 0,
  is_confirmed boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  check_order_sum integer DEFAULT 0,
  check_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.list_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  list_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity text DEFAULT '1'::text,
  is_checked boolean DEFAULT false,
  checked_at timestamp with time zone,
  sort_override integer,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.list_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  name text NOT NULL,
  store_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meal_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  meal_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity text DEFAULT '1'::text
);

CREATE TABLE IF NOT EXISTS public.meals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  name text NOT NULL,
  icon text DEFAULT '🍽️'::text,
  created_at timestamp with time zone DEFAULT now(),
  servings integer
);

CREATE TABLE IF NOT EXISTS public.section_store_routes (
  store_id uuid NOT NULL,
  section_id uuid NOT NULL,
  household_id uuid NOT NULL,
  avg_pos real NOT NULL,
  n integer DEFAULT 1 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sections (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  name_nn text NOT NULL,
  name_nb text,
  name_en text,
  icon text DEFAULT '📦'::text NOT NULL,
  color text DEFAULT '#9CA3AF'::text NOT NULL,
  default_sort_order integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shopping_lists (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  household_id uuid NOT NULL,
  name text NOT NULL,
  store_id uuid,
  is_template boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_maps (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  store_id uuid NOT NULL,
  grid_cols integer DEFAULT 12 NOT NULL,
  grid_rows integer DEFAULT 14 NOT NULL,
  entrance_position jsonb DEFAULT '{"col": 0, "row": 13}'::jsonb,
  checkout_position jsonb DEFAULT '{"col": 11, "row": 13}'::jsonb,
  blocks jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by_household_id uuid
);

CREATE TABLE IF NOT EXISTS public.stores (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  name text NOT NULL,
  chain text NOT NULL,
  address text,
  city text DEFAULT 'Volda'::text,
  latitude double precision,
  longitude double precision,
  is_mapped boolean DEFAULT false,
  mapped_by_household_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  template_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity text DEFAULT '1'::text
);


-- Primary, unique and check constraints
DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.default_store_layouts'::regclass AND conname = 'default_store_layouts_pkey') THEN ALTER TABLE public.default_store_layouts ADD CONSTRAINT default_store_layouts_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.default_store_layouts'::regclass AND conname = 'default_store_layouts_store_id_section_id_key') THEN ALTER TABLE public.default_store_layouts ADD CONSTRAINT default_store_layouts_store_id_section_id_key UNIQUE (store_id, section_id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_store_layouts'::regclass AND conname = 'household_store_layouts_household_id_store_id_section_id_key') THEN ALTER TABLE public.household_store_layouts ADD CONSTRAINT household_store_layouts_household_id_store_id_section_id_key UNIQUE (household_id, store_id, section_id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_store_layouts'::regclass AND conname = 'household_store_layouts_pkey') THEN ALTER TABLE public.household_store_layouts ADD CONSTRAINT household_store_layouts_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_stores'::regclass AND conname = 'household_stores_household_id_store_id_key') THEN ALTER TABLE public.household_stores ADD CONSTRAINT household_stores_household_id_store_id_key UNIQUE (household_id, store_id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_stores'::regclass AND conname = 'household_stores_pkey') THEN ALTER TABLE public.household_stores ADD CONSTRAINT household_stores_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.households'::regclass AND conname = 'households_adults_check') THEN ALTER TABLE public.households ADD CONSTRAINT households_adults_check CHECK (adults IS NULL OR adults >= 0 AND adults <= 20); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.households'::regclass AND conname = 'households_children_check') THEN ALTER TABLE public.households ADD CONSTRAINT households_children_check CHECK (children IS NULL OR children >= 0 AND children <= 20); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.households'::regclass AND conname = 'households_household_code_key') THEN ALTER TABLE public.households ADD CONSTRAINT households_household_code_key UNIQUE (household_code); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.households'::regclass AND conname = 'households_pkey') THEN ALTER TABLE public.households ADD CONSTRAINT households_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.item_store_routes'::regclass AND conname = 'item_store_routes_pkey') THEN ALTER TABLE public.item_store_routes ADD CONSTRAINT item_store_routes_pkey PRIMARY KEY (household_id, item_id, store_id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.items'::regclass AND conname = 'items_pkey') THEN ALTER TABLE public.items ADD CONSTRAINT items_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.list_items'::regclass AND conname = 'list_items_pkey') THEN ALTER TABLE public.list_items ADD CONSTRAINT list_items_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.list_templates'::regclass AND conname = 'list_templates_pkey') THEN ALTER TABLE public.list_templates ADD CONSTRAINT list_templates_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.meal_items'::regclass AND conname = 'meal_items_pkey') THEN ALTER TABLE public.meal_items ADD CONSTRAINT meal_items_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.meals'::regclass AND conname = 'meals_pkey') THEN ALTER TABLE public.meals ADD CONSTRAINT meals_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.meals'::regclass AND conname = 'meals_servings_check') THEN ALTER TABLE public.meals ADD CONSTRAINT meals_servings_check CHECK (servings IS NULL OR servings >= 1 AND servings <= 20); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.section_store_routes'::regclass AND conname = 'section_store_routes_pkey') THEN ALTER TABLE public.section_store_routes ADD CONSTRAINT section_store_routes_pkey PRIMARY KEY (store_id, section_id, household_id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sections'::regclass AND conname = 'sections_pkey') THEN ALTER TABLE public.sections ADD CONSTRAINT sections_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shopping_lists'::regclass AND conname = 'shopping_lists_pkey') THEN ALTER TABLE public.shopping_lists ADD CONSTRAINT shopping_lists_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.store_maps'::regclass AND conname = 'store_maps_pkey') THEN ALTER TABLE public.store_maps ADD CONSTRAINT store_maps_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.store_maps'::regclass AND conname = 'store_maps_store_id_key') THEN ALTER TABLE public.store_maps ADD CONSTRAINT store_maps_store_id_key UNIQUE (store_id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stores'::regclass AND conname = 'stores_pkey') THEN ALTER TABLE public.stores ADD CONSTRAINT stores_pkey PRIMARY KEY (id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.template_items'::regclass AND conname = 'template_items_pkey') THEN ALTER TABLE public.template_items ADD CONSTRAINT template_items_pkey PRIMARY KEY (id); END IF; END $baseline$;


-- Foreign keys (after all referenced keys exist)
DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.default_store_layouts'::regclass AND conname = 'default_store_layouts_created_by_household_id_fkey') THEN ALTER TABLE public.default_store_layouts ADD CONSTRAINT default_store_layouts_created_by_household_id_fkey FOREIGN KEY (created_by_household_id) REFERENCES households(id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.default_store_layouts'::regclass AND conname = 'default_store_layouts_section_id_fkey') THEN ALTER TABLE public.default_store_layouts ADD CONSTRAINT default_store_layouts_section_id_fkey FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.default_store_layouts'::regclass AND conname = 'default_store_layouts_store_id_fkey') THEN ALTER TABLE public.default_store_layouts ADD CONSTRAINT default_store_layouts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_store_layouts'::regclass AND conname = 'household_store_layouts_household_id_fkey') THEN ALTER TABLE public.household_store_layouts ADD CONSTRAINT household_store_layouts_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_store_layouts'::regclass AND conname = 'household_store_layouts_section_id_fkey') THEN ALTER TABLE public.household_store_layouts ADD CONSTRAINT household_store_layouts_section_id_fkey FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_store_layouts'::regclass AND conname = 'household_store_layouts_store_id_fkey') THEN ALTER TABLE public.household_store_layouts ADD CONSTRAINT household_store_layouts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_stores'::regclass AND conname = 'household_stores_household_id_fkey') THEN ALTER TABLE public.household_stores ADD CONSTRAINT household_stores_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.household_stores'::regclass AND conname = 'household_stores_store_id_fkey') THEN ALTER TABLE public.household_stores ADD CONSTRAINT household_stores_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.item_store_routes'::regclass AND conname = 'item_store_routes_household_id_fkey') THEN ALTER TABLE public.item_store_routes ADD CONSTRAINT item_store_routes_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.item_store_routes'::regclass AND conname = 'item_store_routes_item_id_fkey') THEN ALTER TABLE public.item_store_routes ADD CONSTRAINT item_store_routes_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.item_store_routes'::regclass AND conname = 'item_store_routes_store_id_fkey') THEN ALTER TABLE public.item_store_routes ADD CONSTRAINT item_store_routes_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.items'::regclass AND conname = 'items_household_id_fkey') THEN ALTER TABLE public.items ADD CONSTRAINT items_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.items'::regclass AND conname = 'items_section_id_fkey') THEN ALTER TABLE public.items ADD CONSTRAINT items_section_id_fkey FOREIGN KEY (section_id) REFERENCES sections(id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.list_items'::regclass AND conname = 'list_items_item_id_fkey') THEN ALTER TABLE public.list_items ADD CONSTRAINT list_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.list_items'::regclass AND conname = 'list_items_list_id_fkey') THEN ALTER TABLE public.list_items ADD CONSTRAINT list_items_list_id_fkey FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.list_templates'::regclass AND conname = 'list_templates_household_id_fkey') THEN ALTER TABLE public.list_templates ADD CONSTRAINT list_templates_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.list_templates'::regclass AND conname = 'list_templates_store_id_fkey') THEN ALTER TABLE public.list_templates ADD CONSTRAINT list_templates_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.meal_items'::regclass AND conname = 'meal_items_item_id_fkey') THEN ALTER TABLE public.meal_items ADD CONSTRAINT meal_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.meal_items'::regclass AND conname = 'meal_items_meal_id_fkey') THEN ALTER TABLE public.meal_items ADD CONSTRAINT meal_items_meal_id_fkey FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.meals'::regclass AND conname = 'meals_household_id_fkey') THEN ALTER TABLE public.meals ADD CONSTRAINT meals_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.section_store_routes'::regclass AND conname = 'section_store_routes_household_id_fkey') THEN ALTER TABLE public.section_store_routes ADD CONSTRAINT section_store_routes_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.section_store_routes'::regclass AND conname = 'section_store_routes_section_id_fkey') THEN ALTER TABLE public.section_store_routes ADD CONSTRAINT section_store_routes_section_id_fkey FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.section_store_routes'::regclass AND conname = 'section_store_routes_store_id_fkey') THEN ALTER TABLE public.section_store_routes ADD CONSTRAINT section_store_routes_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shopping_lists'::regclass AND conname = 'shopping_lists_household_id_fkey') THEN ALTER TABLE public.shopping_lists ADD CONSTRAINT shopping_lists_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shopping_lists'::regclass AND conname = 'shopping_lists_store_id_fkey') THEN ALTER TABLE public.shopping_lists ADD CONSTRAINT shopping_lists_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.store_maps'::regclass AND conname = 'store_maps_store_id_fkey') THEN ALTER TABLE public.store_maps ADD CONSTRAINT store_maps_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.store_maps'::regclass AND conname = 'store_maps_updated_by_household_id_fkey') THEN ALTER TABLE public.store_maps ADD CONSTRAINT store_maps_updated_by_household_id_fkey FOREIGN KEY (updated_by_household_id) REFERENCES households(id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stores'::regclass AND conname = 'stores_mapped_by_household_id_fkey') THEN ALTER TABLE public.stores ADD CONSTRAINT stores_mapped_by_household_id_fkey FOREIGN KEY (mapped_by_household_id) REFERENCES households(id); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.template_items'::regclass AND conname = 'template_items_item_id_fkey') THEN ALTER TABLE public.template_items ADD CONSTRAINT template_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE; END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.template_items'::regclass AND conname = 'template_items_template_id_fkey') THEN ALTER TABLE public.template_items ADD CONSTRAINT template_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES list_templates(id) ON DELETE CASCADE; END IF; END $baseline$;


-- Standalone indexes
CREATE INDEX IF NOT EXISTS idx_default_store_layouts_store ON public.default_store_layouts USING btree (store_id);

CREATE INDEX IF NOT EXISTS idx_household_store_layouts ON public.household_store_layouts USING btree (household_id, store_id);

CREATE INDEX IF NOT EXISTS idx_household_stores ON public.household_stores USING btree (household_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_households_code ON public.households USING btree (household_code);

CREATE INDEX IF NOT EXISTS idx_items_household ON public.items USING btree (household_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_household_name_unique ON public.items USING btree (household_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_items_name ON public.items USING btree (household_id, name);

CREATE INDEX IF NOT EXISTS idx_list_items_list ON public.list_items USING btree (list_id);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_household ON public.shopping_lists USING btree (household_id);

CREATE INDEX IF NOT EXISTS idx_stores_city ON public.stores USING btree (city);


-- Trigger functions
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;


-- Triggers
DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.households'::regclass AND tgname = 'households_updated_at') THEN CREATE TRIGGER households_updated_at BEFORE UPDATE ON public.households FOR EACH ROW EXECUTE FUNCTION update_updated_at(); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.shopping_lists'::regclass AND tgname = 'shopping_lists_updated_at') THEN CREATE TRIGGER shopping_lists_updated_at BEFORE UPDATE ON public.shopping_lists FOR EACH ROW EXECUTE FUNCTION update_updated_at(); END IF; END $baseline$;

DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.store_maps'::regclass AND tgname = 'store_maps_updated_at') THEN CREATE TRIGGER store_maps_updated_at BEFORE UPDATE ON public.store_maps FOR EACH ROW EXECUTE FUNCTION update_updated_at(); END IF; END $baseline$;


-- Row Level Security
ALTER TABLE public.default_store_layouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.household_store_layouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.household_stores ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.item_store_routes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.list_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meal_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.section_store_routes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.store_maps ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.template_items ENABLE ROW LEVEL SECURITY;

-- Preserve the app's server-only access model, including future objects.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
COMMIT;
