-- List-only dinner adjustments. Saved meals and meal_items are never updated.
begin;
alter table public.list_meal_ingredients add column base_quantity text;
alter table public.list_meal_ingredients add column base_servings numeric check(base_servings>0 and base_servings<=100);

create or replace function public.list_quantity_scale(q text,from_servings numeric,to_servings numeric) returns text
language plpgsql immutable security invoker set search_path=public,pg_catalog as $$
declare parts text[]; amount numeric; unit text; precision_digits integer;
begin
  parts:=regexp_match(replace(trim(q),',','.'),'^(\d+(?:\.\d+)?)(?: (stk|g|kg|ml|dl|L|pakke|porsjon))?$');
  if parts is null or from_servings is null or from_servings<=0 or to_servings is null or to_servings<=0 then return null;end if;
  if parts[1]::numeric<=0 then return null;end if;
  if from_servings=to_servings then return q;end if;
  precision_digits:=least(6,greatest(2,length(split_part(parts[1],'.',2))+2));
  amount:=greatest(power(10::numeric,-precision_digits),round(parts[1]::numeric*to_servings/from_servings,precision_digits));unit:=coalesce(parts[2],'stk');
  return trim_scale(amount)::text||case when unit='stk' then '' else ' '||unit end;
end $$;

create or replace function public.list_quantity_replace(total text,previous text,next_quantity text) returns text
language plpgsql immutable security invoker set search_path=public,pg_catalog as $$
declare remainder text; reversed text;
begin
  if public.list_quantity_scale(next_quantity,1,1) is null then return null;end if;
  if trim(total)=trim(previous) then return next_quantity;end if;
  reversed:=public.list_quantity_difference(previous,total);
  if reversed is null or reversed<>'0' then return null;end if;
  remainder:=public.list_quantity_difference(total,previous);
  if remainder='0' then return next_quantity;end if;
  return public.list_quantity_sum(remainder,next_quantity);
end $$;

create or replace function public.adjust_list_meal(p_household uuid,p_list uuid,p_payload jsonb) returns uuid[]
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare meal public.list_meals; source public.list_meal_ingredients; line public.list_items;
  kind text:=p_payload->>'kind'; wanted numeric; previous_servings numeric; next_quantity text; total text;
  changed uuid[]:='{}'; found_source boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_household::text,0));
  if not exists(select 1 from public.shopping_lists where id=p_list and household_id=p_household) then
    raise exception 'Ingen tilgang' using errcode='42501';end if;
  select * into meal from public.list_meals where id=(p_payload->>'mealId')::uuid and list_id=p_list for update;
  if not found then raise exception 'MEAL_NOT_FOUND' using errcode='22023';end if;
  if kind not in ('mealServings','mealQty') then raise exception 'Ugyldig operasjon';end if;
  previous_servings:=meal.servings;
  if kind='mealServings' then
    wanted:=(p_payload->>'servings')::numeric;
    previous_servings:=coalesce(previous_servings,(p_payload->>'fromServings')::numeric);
    if wanted is null or wanted<0.5 or wanted>100 or previous_servings is null or previous_servings<0.5 or previous_servings>100 then
      raise exception 'MEAL_SERVINGS_REQUIRED' using errcode='22023';end if;
  else
    next_quantity:=p_payload->>'quantity';
    if length(next_quantity)>80 or public.list_quantity_scale(next_quantity,1,1) is null then
      raise exception 'MEAL_INVALID_QUANTITY' using errcode='22023';end if;
  end if;
  for source in select * from public.list_meal_ingredients where list_meal_id=meal.id
    and (kind='mealServings' or item_id=(p_payload->>'itemId')::uuid)
  loop
    found_source:=true;
    select * into line from public.list_items where id=source.list_item_id and list_id=p_list for update;
    if not found or source.quantity is null then
      if kind='mealQty' then raise exception 'MEAL_SOURCE_MANUAL' using errcode='22023';end if;
      continue;
    end if;
    if kind='mealServings' then
      next_quantity:=public.list_quantity_scale(coalesce(source.base_quantity,source.quantity),coalesce(source.base_servings,previous_servings),wanted);
      -- Text amounts such as "etter smak" have no safe numeric scale.
      if next_quantity is null then continue;end if;
    end if;
    total:=public.list_quantity_replace(line.quantity,source.quantity,next_quantity);
    if total is null then raise exception 'MEAL_QUANTITY_CONFLICT' using errcode='22023';end if;
    update public.list_items set quantity=total where id=line.id;
    update public.list_meal_ingredients set quantity=next_quantity,
      base_quantity=case when kind='mealQty' then next_quantity else coalesce(base_quantity,source.quantity) end,
      base_servings=case when kind='mealQty' then previous_servings else coalesce(base_servings,previous_servings) end
      where list_meal_id=meal.id and item_id=source.item_id;
    changed:=array_append(changed,line.id);
  end loop;
  if kind='mealQty' and not found_source then raise exception 'MEAL_NOT_FOUND' using errcode='22023';end if;
  if kind='mealServings' then update public.list_meals set servings=wanted where id=meal.id;end if;
  return changed;
end $$;

create or replace function public.list_meal_snapshot(p_list uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'icon',m.icon,'servings',m.servings,
    'ingredients',(select coalesce(jsonb_agg(jsonb_build_object('item_id',i.item_id,'list_item_id',i.list_item_id,
      'name',i.name,'quantity',i.quantity,'base_quantity',i.base_quantity,'base_servings',i.base_servings) order by i.name),'[]'::jsonb)
      from public.list_meal_ingredients i where i.list_meal_id=m.id)) order by m.created_at,m.id),'[]'::jsonb)
  from public.list_meals m where m.list_id=p_list;
$$;
revoke all on function public.list_quantity_scale(text,numeric,numeric),public.list_quantity_replace(text,text,text),public.adjust_list_meal(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.list_quantity_scale(text,numeric,numeric),public.list_quantity_replace(text,text,text),public.adjust_list_meal(uuid,uuid,jsonb) to service_role;

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
  elsif kind in ('mealServings','mealQty') then
    changed_ids:=public.adjust_list_meal(p_household,p_list,p_payload);
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
commit;
