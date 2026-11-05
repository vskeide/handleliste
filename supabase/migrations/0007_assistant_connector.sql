-- OAuth for subscription-based ChatGPT/Claude connections. No model API calls.
-- All credentials are stored as hashes; only the server role can access these APIs.
begin;
create table if not exists public.connector_clients (
  id text primary key,
  name text not null,
  redirect_uris jsonb not null,
  secret_hash text,
  auth_method text not null default 'none',
  created_at timestamptz not null default now()
);
create table if not exists public.connector_codes (
  code_hash text primary key,
  client_id text not null references public.connector_clients(id),
  household_id uuid not null references public.households(id) on delete cascade,
  redirect_uri text not null,
  challenge text not null,
  resource text not null,
  scope text not null,
  used_at timestamptz,
  expires_at timestamptz not null default now() + interval '5 minutes'
);
create table if not exists public.connector_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  client_id text not null references public.connector_clients(id),
  client_name text not null,
  scope text not null,
  resource text not null,
  access_hash text not null unique,
  refresh_hash text not null unique,
  access_expires_at timestamptz not null default now() + interval '1 hour',
  refresh_expires_at timestamptz not null default now() + interval '90 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists connector_connections_household on public.connector_connections(household_id);
create table if not exists public.connector_write_receipts (
  household_id uuid not null references public.households(id) on delete cascade,
  operation_id uuid not null,
  kind text not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(household_id,operation_id)
);
create table if not exists public.connector_rate_limits (
  bucket text primary key,
  hits integer not null default 1,
  expires_at timestamptz not null
);
alter table public.meals add column if not exists source_url text,
  add column if not exists recipe_text text;

alter table public.connector_clients enable row level security;
alter table public.connector_codes enable row level security;
alter table public.connector_connections enable row level security;
alter table public.connector_write_receipts enable row level security;
alter table public.connector_rate_limits enable row level security;
revoke all on public.connector_clients,public.connector_codes,public.connector_connections,
  public.connector_write_receipts,public.connector_rate_limits from public,anon,authenticated;
grant all on public.connector_clients,public.connector_codes,public.connector_connections,
  public.connector_write_receipts,public.connector_rate_limits to service_role;

create or replace function public.connector_rate_limit(p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path=public,pg_catalog as $$
declare count_now integer;
begin
  insert into public.connector_rate_limits(bucket,expires_at) values(p_bucket,now()+make_interval(secs=>p_seconds))
    on conflict(bucket) do update set hits=case when connector_rate_limits.expires_at<=now() then 1 else connector_rate_limits.hits+1 end,
      expires_at=case when connector_rate_limits.expires_at<=now() then now()+make_interval(secs=>p_seconds) else connector_rate_limits.expires_at end
    returning hits into count_now;
  return count_now<=p_limit;
end $$;

create or replace function public.connector_exchange_code(p_hash text,p_client text,p_redirect text,
  p_challenge text,p_resource text,p_access text,p_refresh text)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare code public.connector_codes; connection public.connector_connections;
begin
  select * into code from public.connector_codes where code_hash=p_hash for update;
  if not found or code.used_at is not null or code.expires_at<=now() or code.client_id<>p_client or code.redirect_uri<>p_redirect
    or code.challenge<>p_challenge or code.resource<>p_resource then return null; end if;
  insert into public.connector_connections(household_id,client_id,client_name,scope,resource,access_hash,refresh_hash)
    select code.household_id,code.client_id,name,code.scope,code.resource,p_access,p_refresh
    from public.connector_clients where id=code.client_id returning * into connection;
  update public.connector_codes set used_at=now() where code_hash=p_hash;
  return jsonb_build_object('scope',connection.scope,'id',connection.id);
end $$;

create or replace function public.connector_write(p_household uuid,p_operation uuid,p_kind text,p_input jsonb,p_prepared jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare receipt public.connector_write_receipts; meal public.meals; product public.items;
  entry jsonb; ingredient public.meal_items; quantity text; combined text; result jsonb;
  list_result jsonb; target_list uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_household::text,0));
  select * into receipt from public.connector_write_receipts where household_id=p_household and operation_id=p_operation;
  if found then
    if receipt.kind<>p_kind or receipt.input<>p_input then raise exception 'Request ID already used for another action'; end if;
    return receipt.result;
  end if;
  if octet_length(p_input::text)>100000 or octet_length(p_prepared::text)>100000 then raise exception 'Request too large'; end if;
  if p_input ? 'list_id' then
    target_list:=(p_input->>'list_id')::uuid;
    if not exists(select 1 from public.shopping_lists where id=target_list and household_id=p_household) then
      raise exception 'List not found in this household' using errcode='42501';
    end if;
  end if;
  if p_kind='add_items' then
    if target_list is null then raise exception 'Choose a list'; end if;
    list_result:=public.apply_list_operation(p_household,target_list,p_operation,p_prepared);
    result:=jsonb_build_object('list_id',target_list,'added',list_result->'added','merged',list_result->'merged',
      'restored',list_result->'restored','unchanged',list_result->'kept');
  elsif p_kind='save_meal' then
    if coalesce(length(trim(p_input->>'name')),0) not between 1 and 100 or coalesce((p_input->>'servings')::integer,0) not between 1 and 20 then
      raise exception 'Invalid meal';
    end if;
    if jsonb_typeof(p_prepared->'lines')<>'array' or jsonb_array_length(p_prepared->'lines') not between 1 and 100 then
      raise exception 'Invalid ingredients';
    end if;
    insert into public.meals(household_id,name,icon,servings,source_url,recipe_text)
      values(p_household,trim(p_input->>'name'),coalesce(p_input->>'icon','🍽️'),(p_input->>'servings')::integer,
        p_input->>'source_url',p_input->>'recipe_text') returning * into meal;
    for entry in select value from jsonb_array_elements(p_prepared->'lines') loop
      insert into public.items(id,household_id,name,section_id,is_confirmed)
        values((entry->>'itemId')::uuid,p_household,entry->>'name',(entry->>'sectionId')::uuid,true) on conflict do nothing;
      select * into product from public.items where household_id=p_household and lower(name)=lower(entry->>'name');
      if product.id is null then raise exception 'Ingredient not found'; end if;
      quantity:=entry->>'quantity';
      select * into ingredient from public.meal_items where meal_id=meal.id and item_id=product.id;
      if found then
        combined:=public.list_quantity_sum(ingredient.quantity,quantity);
        if combined is null then raise exception 'Incompatible quantities for repeated ingredient'; end if;
        update public.meal_items set quantity=combined where id=ingredient.id;
      else
        insert into public.meal_items(meal_id,item_id,quantity) values(meal.id,product.id,quantity);
      end if;
    end loop;
    result:=jsonb_build_object('meal_id',meal.id,'name',meal.name,'servings',meal.servings);
    if target_list is not null then
      list_result:=public.apply_list_operation(p_household,target_list,p_operation,
        jsonb_build_object('kind','batch','lines',p_prepared->'listLines'));
      result:=result||jsonb_build_object('list_id',target_list,'added',list_result->'added','merged',list_result->'merged',
        'restored',list_result->'restored','unchanged',list_result->'kept');
    end if;
  elsif p_kind='add_meal_to_list' then
    if target_list is null or not exists(select 1 from public.meals where id=(p_input->>'meal_id')::uuid and household_id=p_household) then
      raise exception 'Meal or list not found in this household' using errcode='42501';
    end if;
    list_result:=public.apply_list_operation(p_household,target_list,p_operation,p_prepared);
    result:=jsonb_build_object('meal_id',p_input->'meal_id','list_id',target_list,'added',list_result->'added',
      'merged',list_result->'merged','restored',list_result->'restored','unchanged',list_result->'kept');
  else raise exception 'Unknown connector action'; end if;
  insert into public.connector_write_receipts(household_id,operation_id,kind,input,result)
    values(p_household,p_operation,p_kind,p_input,result);
  return result;
end $$;
revoke all on function public.connector_rate_limit(text,integer,integer),
  public.connector_exchange_code(text,text,text,text,text,text,text),
  public.connector_write(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.connector_rate_limit(text,integer,integer),
  public.connector_exchange_code(text,text,text,text,text,text,text),
  public.connector_write(uuid,uuid,text,jsonb,jsonb) to service_role;
commit;
