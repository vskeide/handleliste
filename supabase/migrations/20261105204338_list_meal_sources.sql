-- Meal snapshots and actual ingredient contributions, private to each list.
begin;
create table public.list_meals (
  id uuid primary key,
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  meal_id uuid references public.meals(id) on delete set null,
  name text not null check(length(name) between 1 and 100),
  icon text not null default '🍽️' check(length(icon)<=20),
  servings numeric check(servings>0 and servings<=100),
  created_at timestamptz not null default now()
);
create index list_meals_list on public.list_meals(list_id);
create index list_meals_recipe on public.list_meals(meal_id);
create table public.list_meal_ingredients (
  list_meal_id uuid not null references public.list_meals(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  list_item_id uuid references public.list_items(id) on delete set null,
  name text not null,
  quantity text,
  primary key(list_meal_id,item_id)
);
create index list_meal_ingredients_line on public.list_meal_ingredients(list_item_id);
create index list_meal_ingredients_product on public.list_meal_ingredients(item_id);
alter table public.list_meals enable row level security;
alter table public.list_meal_ingredients enable row level security;
revoke all on public.list_meals,public.list_meal_ingredients from public,anon,authenticated;
grant all on public.list_meals,public.list_meal_ingredients to service_role;

create or replace function public.list_quantity_difference(a text,b text) returns text
language plpgsql immutable security invoker set search_path=public,pg_catalog as $$
declare x text[]; y text[]; ux text; uy text; vx numeric; vy numeric; u text;
begin
  if trim(a)=trim(b) then return '0';end if;
  x:=regexp_match(replace(trim(a),',','.'),'^(\d+(?:\.\d+)?)(?: (stk|g|kg|ml|dl|L|pakke|porsjon))?$');
  y:=regexp_match(replace(trim(b),',','.'),'^(\d+(?:\.\d+)?)(?: (stk|g|kg|ml|dl|L|pakke|porsjon))?$');
  if x is null or y is null then return null; end if;
  ux:=coalesce(x[2],'stk'); uy:=coalesce(y[2],'stk'); vx:=x[1]::numeric; vy:=y[1]::numeric;
  if ux=uy then u:=ux;
  elsif ux in ('g','kg') and uy in ('g','kg') then
    vx:=vx*case when ux='kg' then 1000 else 1 end; vy:=vy*case when uy='kg' then 1000 else 1 end; u:='g';
    if vx-vy>=1000 then vx:=vx/1000;vy:=vy/1000;u:='kg';end if;
  elsif ux in ('ml','dl','L') and uy in ('ml','dl','L') then
    vx:=vx*case ux when 'L' then 1000 when 'dl' then 100 else 1 end;
    vy:=vy*case uy when 'L' then 1000 when 'dl' then 100 else 1 end;u:='ml';
    if vx-vy>=1000 then vx:=vx/1000;vy:=vy/1000;u:='L';
    elsif vx-vy>=100 and mod(vx-vy,100)=0 then vx:=vx/100;vy:=vy/100;u:='dl';end if;
  else return null;end if;
  if vx-vy<=0 then return '0';end if;
  return trim_scale(round(vx-vy,2))::text||case when u='stk' then '' else ' '||u end;
end $$;

create or replace function public.list_meal_snapshot(p_list uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'icon',m.icon,'servings',m.servings,
    'ingredients',(select coalesce(jsonb_agg(jsonb_build_object('item_id',i.item_id,'list_item_id',i.list_item_id,
      'name',i.name,'quantity',i.quantity) order by i.name),'[]'::jsonb) from public.list_meal_ingredients i where i.list_meal_id=m.id))
    order by m.created_at,m.id),'[]'::jsonb) from public.list_meals m where m.list_id=p_list;
$$;
create or replace function public.get_list_contents(p_household uuid,p_list uuid) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_catalog as $$
begin
  if not exists(select 1 from public.shopping_lists where id=p_list and household_id=p_household) then
    raise exception 'Ingen tilgang' using errcode='42501';end if;
  return jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at),'[]'::jsonb)
    from public.list_items l where l.list_id=p_list),'meals',public.list_meal_snapshot(p_list));
end $$;
revoke all on function public.list_quantity_difference(text,text),public.list_meal_snapshot(uuid),public.get_list_contents(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_quantity_difference(text,text),public.list_meal_snapshot(uuid),public.get_list_contents(uuid,uuid) to service_role;

create or replace function public.apply_list_operation(p_household uuid, p_list uuid, p_operation uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare
  receipt public.list_write_receipts; li public.list_items; product public.items;
  entry jsonb; entries jsonb; kind text := p_payload->>'kind'; qty text; summed text;
  aliases jsonb := '{}'::jsonb; products jsonb := '[]'::jsonb; answer jsonb;
  added int:=0; merged int:=0; restored int:=0; kept int:=0;
  already int; total int; pos real; shop uuid; record_route boolean;
  changed_ids uuid[] := '{}';
  previous_list uuid; meal_source jsonb:=p_payload->'meal'; source_id uuid; contribution text;
  source_line uuid; removed_ids uuid[]:='{}'; source record;

begin
  -- Serialize this household's operations, including concurrent devices, until commit.
  perform pg_advisory_xact_lock(hashtextextended(p_household::text, 0));
  if not exists(select 1 from public.shopping_lists where id=p_list and household_id=p_household) then
    raise exception 'Ingen tilgang' using errcode='42501';
  end if;
  select * into receipt from public.list_write_receipts where household_id=p_household and operation_id=p_operation;
  if found then
    if receipt.list_id<>p_list or receipt.payload<>p_payload then raise exception 'Ugyldig operasjon'; end if;
    return receipt.result;
  end if;
  if octet_length(p_payload::text)>100000 then raise exception 'For mange varer'; end if;
  if kind='batch' and meal_source is not null then
    source_id:=(meal_source->>'id')::uuid;
    if meal_source->>'mealId' is not null and not exists(select 1 from public.meals where id=(meal_source->>'mealId')::uuid and household_id=p_household) then
      raise exception 'Ingen tilgang' using errcode='42501';end if;
    insert into public.list_meals(id,list_id,meal_id,name,icon,servings) values(source_id,p_list,
      (meal_source->>'mealId')::uuid,trim(meal_source->>'name'),coalesce(meal_source->>'icon','🍽️'),(meal_source->>'servings')::numeric);
  end if;
  if kind='copy' then
    select sl.id into previous_list from public.shopping_lists sl
      where sl.household_id=p_household and sl.id<>p_list and exists(select 1 from public.list_items x where x.list_id=sl.id)
      order by (select max(created_at) from public.list_items x where x.list_id=sl.id) desc limit 1;
    if previous_list is null then raise exception 'Fann inga tidlegare liste'; end if;
    select jsonb_agg(jsonb_build_object('itemId',item_id,'clientId',gen_random_uuid(),'quantity',coalesce(quantity,'1')))
      into entries from public.list_items where list_id=previous_list;
    kind:='batch';
  end if;
  if kind in ('add','create','batch') then
    entries := coalesce(entries,case when kind='batch' then p_payload->'lines' else jsonb_build_array(p_payload) end);
    if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries) not between 1 and 100 then raise exception 'Ugyldige varer'; end if;
    for entry in select value from jsonb_array_elements(entries) loop
      qty := coalesce(nullif(entry->>'quantity',''),'1');
      if length(qty)>80 then raise exception 'Ugyldig mengde'; end if;
      if entry->>'kind'='create' or entry ? 'create' then
        if length(trim(entry->>'name')) not between 1 and 100 then raise exception 'Ugyldig namn'; end if;
        insert into public.items(id,household_id,name,section_id,is_confirmed)
        values ((entry->>'itemId')::uuid,p_household,trim(entry->>'name'),(entry->>'sectionId')::uuid,coalesce((entry->>'confirmed')::boolean,false))
        on conflict do nothing;
        select * into product from public.items where household_id=p_household and lower(name)=lower(trim(entry->>'name'));
      else
        select * into product from public.items where household_id=p_household and id=coalesce(aliases->>(entry->>'itemId'),entry->>'itemId')::uuid;
      end if;
      if product.id is null then raise exception 'Fann ikkje vara'; end if;
      products:=products || jsonb_build_array(jsonb_build_object('id',product.id,'name',product.name,'section_id',product.section_id,'is_confirmed',product.is_confirmed,'times_purchased',product.times_purchased));
      aliases:=aliases || jsonb_build_object(entry->>'itemId',product.id::text);
      select * into li from public.list_items where list_id=p_list and item_id=product.id;
      contribution:=null; source_line:=null;
      if not found then
        contribution:=qty;
        insert into public.list_items(id,list_id,item_id,quantity) values ((entry->>'clientId')::uuid,p_list,product.id,qty) returning * into li;
        added:=added+1;
      elsif li.is_checked then
        -- A new visit reusing a checked line must not inherit the old meal's ownership.
        update public.list_meal_ingredients set list_item_id=null where list_item_id=li.id;
        contribution:=qty;
        update public.list_items set is_checked=false,checked_at=null,quantity=qty where id=li.id returning * into li;
        restored:=restored+1;
      elsif kind='batch' then
        summed:=public.list_quantity_sum(li.quantity,qty);
        if summed is null then kept:=kept+1;
        else contribution:=qty; update public.list_items set quantity=summed where id=li.id returning * into li; merged:=merged+1; end if;
      end if;
      aliases:=aliases || jsonb_build_object(entry->>'clientId',li.id::text);
      if source_id is not null then
        if contribution is not null then source_line:=li.id;end if;
        insert into public.list_meal_ingredients as s(list_meal_id,item_id,list_item_id,name,quantity)
          values(source_id,product.id,source_line,product.name,contribution)
          on conflict(list_meal_id,item_id) do update set list_item_id=coalesce(excluded.list_item_id,s.list_item_id),
            quantity=case when excluded.quantity is null then s.quantity when s.quantity is null then excluded.quantity
              else public.list_quantity_sum(s.quantity,excluded.quantity) end;
      end if;
      changed_ids:=array_append(changed_ids,li.id);
    end loop;
  elsif kind in ('qty','toggle','remove') then
    select * into li from public.list_items where id=(p_payload->>'listItemId')::uuid and list_id=p_list;
    changed_ids:=array_append(changed_ids,li.id);
    if not found and kind<>'remove' then raise exception 'Vara er fjerna frå lista'; end if;
    if kind='remove' then delete from public.list_items where id=li.id and list_id=p_list;
    elsif kind='qty' then
      qty:=p_payload->>'quantity';
      if qty is null or length(qty) not between 1 and 80 then raise exception 'Ugyldig mengde'; end if;
      -- An explicit quantity override becomes manual: never subtract guessed shares later.
      if li.quantity is distinct from qty then update public.list_meal_ingredients set quantity=null where list_item_id=li.id;end if;
      update public.list_items set quantity=qty where id=li.id;
    elsif li.is_checked is distinct from (p_payload->>'checked')::boolean then
      if (p_payload->>'checked')::boolean then
        select count(*) filter(where is_checked),count(*) into already,total from public.list_items where list_id=p_list;
        record_route:=coalesce((p_payload->>'record')::boolean,true);
        update public.items set times_purchased=coalesce(times_purchased,0)+1,
          check_order_sum=coalesce(check_order_sum,0)+case when record_route then already+1 else 0 end,
          check_count=coalesce(check_count,0)+case when record_route then 1 else 0 end
          where id=li.item_id returning * into product;

      end if;
      update public.list_items set is_checked=(p_payload->>'checked')::boolean,
        checked_at=case when (p_payload->>'checked')::boolean then now() else null end,route_store_id=null,route_picked_at=null where id=li.id;
      if (p_payload->>'checked')::boolean and record_route then
        perform public.record_relative_pick(p_household,li.id,(p_payload->>'pickedAt')::timestamptz);
      end if;
    end if;
  elsif kind='mealRemove' then
    source_id:=(p_payload->>'mealId')::uuid;
    if exists(select 1 from public.list_meals where id=source_id and list_id<>p_list) then
      raise exception 'Ingen tilgang' using errcode='42501';end if;
    for source in select * from public.list_meal_ingredients where list_meal_id=source_id
      and (not (p_payload ? 'itemId') or item_id=(p_payload->>'itemId')::uuid)
    loop
      select * into li from public.list_items where id=source.list_item_id and list_id=p_list;
      if found and source.quantity is not null then
        qty:=public.list_quantity_difference(li.quantity,source.quantity);
        if qty='0' then
          delete from public.list_items where id=li.id;removed_ids:=array_append(removed_ids,li.id);
        elsif qty is not null then
          update public.list_items set quantity=qty where id=li.id;changed_ids:=array_append(changed_ids,li.id);
        end if;
      end if;
    end loop;
    if p_payload ? 'itemId' then delete from public.list_meal_ingredients where list_meal_id=source_id and item_id=(p_payload->>'itemId')::uuid;
    else delete from public.list_meals where id=source_id and list_id=p_list;end if;
  elsif kind='uncheck' then update public.list_items set is_checked=false,checked_at=null where list_id=p_list and is_checked;
  else raise exception 'Ugyldig operasjon'; end if;
  answer:=jsonb_build_object('aliases',aliases,'items',products,'added',added,'merged',merged,'restored',restored,'kept',kept,
    'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.list_items l where l.list_id=p_list and (kind='uncheck' or l.id=any(changed_ids))),
    'meals',public.list_meal_snapshot(p_list),'removedIds',to_jsonb(removed_ids),
    'removed',case when kind='remove' then p_payload->>'listItemId' else null end);
  insert into public.list_write_receipts(household_id,operation_id,list_id,payload,result) values(p_household,p_operation,p_list,p_payload,answer);
  return answer;
end $$;

revoke all on function public.apply_list_operation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_list_operation(uuid,uuid,uuid,jsonb) to service_role;

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
        jsonb_build_object('kind','batch','lines',p_prepared->'listLines','meal',jsonb_build_object(
          'id',p_operation,'mealId',meal.id,'name',meal.name,'icon',meal.icon,'servings',coalesce((p_input->>'portions')::numeric,(select case when adults is not null then greatest(1,adults+coalesce(children,0)*0.5) else family_size end from public.households where id=p_household),meal.servings))));
      result:=result||jsonb_build_object('list_id',target_list,'added',list_result->'added','merged',list_result->'merged',
        'restored',list_result->'restored','unchanged',list_result->'kept');
    end if;
  elsif p_kind='add_meal_to_list' then
    if target_list is null or not exists(select 1 from public.meals where id=(p_input->>'meal_id')::uuid and household_id=p_household) then
      raise exception 'Meal or list not found in this household' using errcode='42501';
    end if;
    select * into meal from public.meals where id=(p_input->>'meal_id')::uuid and household_id=p_household;
    list_result:=public.apply_list_operation(p_household,target_list,p_operation,p_prepared||jsonb_build_object('meal',
      jsonb_build_object('id',p_operation,'mealId',meal.id,'name',meal.name,'icon',meal.icon,'servings',
        coalesce((p_input->>'portions')::numeric,(select case when adults is not null then greatest(1,adults+coalesce(children,0)*0.5) else family_size end from public.households where id=p_household),meal.servings))));
    result:=jsonb_build_object('meal_id',p_input->'meal_id','list_id',target_list,'added',list_result->'added',
      'merged',list_result->'merged','restored',list_result->'restored','unchanged',list_result->'kept');
  else raise exception 'Unknown connector action'; end if;
  insert into public.connector_write_receipts(household_id,operation_id,kind,input,result)
    values(p_household,p_operation,p_kind,p_input,result);
  return result;
end $$;

commit;
