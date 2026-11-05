-- Retry receipts and atomic list writes. No existing rows are removed.
-- Apply before deploying the new client. Only the service role can execute these APIs.
begin;
create unique index if not exists list_items_list_item_unique on public.list_items(list_id, item_id);

create table if not exists public.list_write_receipts (
  household_id uuid not null references public.households(id) on delete cascade,
  operation_id uuid not null,
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (household_id, operation_id)
);
create index if not exists list_write_receipts_list on public.list_write_receipts(list_id);
alter table public.list_write_receipts enable row level security;
revoke all on public.list_write_receipts from public, anon, authenticated;
grant all on public.list_write_receipts to service_role;

create or replace function public.list_quantity_sum(a text, b text) returns text
language plpgsql immutable security invoker set search_path = public, pg_catalog as $$
declare x text[]; y text[]; ux text; uy text; vx numeric; vy numeric; u text;
begin
  x := regexp_match(replace(trim(a), ',', '.'), '^(\d+(?:\.\d+)?)(?: (stk|g|kg|ml|dl|L|pakke|porsjon))?$');
  y := regexp_match(replace(trim(b), ',', '.'), '^(\d+(?:\.\d+)?)(?: (stk|g|kg|ml|dl|L|pakke|porsjon))?$');
  if x is null or y is null then return null; end if;
  ux := coalesce(x[2], 'stk'); uy := coalesce(y[2], 'stk'); vx := x[1]::numeric; vy := y[1]::numeric;
  if ux = uy then u := ux;
  elsif ux in ('g','kg') and uy in ('g','kg') then
    vx := vx * case when ux='kg' then 1000 else 1 end;
    vy := vy * case when uy='kg' then 1000 else 1 end; u := 'g';
    if vx+vy >= 1000 then vx:=vx/1000; vy:=vy/1000; u:='kg'; end if;
  elsif ux in ('ml','dl','L') and uy in ('ml','dl','L') then
    vx:=vx * case ux when 'L' then 1000 when 'dl' then 100 else 1 end;
    vy:=vy * case uy when 'L' then 1000 when 'dl' then 100 else 1 end; u:='ml';
    if vx+vy >= 1000 then vx:=vx/1000; vy:=vy/1000; u:='L';
    elsif vx+vy >= 100 and mod(vx+vy,100)=0 then vx:=vx/100; vy:=vy/100; u:='dl'; end if;
  else return null; end if;
  return trim_scale(round(vx+vy,2))::text || case when u='stk' then '' else ' '||u end;
end $$;

create or replace function public.apply_list_operation(p_household uuid, p_list uuid, p_operation uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare
  receipt public.list_write_receipts; li public.list_items; product public.items;
  entry jsonb; entries jsonb; kind text := p_payload->>'kind'; qty text; summed text;
  aliases jsonb := '{}'::jsonb; products jsonb := '[]'::jsonb; answer jsonb;
  added int:=0; merged int:=0; restored int:=0; kept int:=0;
  already int; total int; pos real; shop uuid; record_route boolean;
  changed_ids uuid[] := '{}';
  previous_list uuid;
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
      if not found then
        insert into public.list_items(id,list_id,item_id,quantity) values ((entry->>'clientId')::uuid,p_list,product.id,qty) returning * into li;
        added:=added+1;
      elsif li.is_checked then
        update public.list_items set is_checked=false,checked_at=null,quantity=qty where id=li.id returning * into li;
        restored:=restored+1;
      elsif kind='batch' then
        summed:=public.list_quantity_sum(li.quantity,qty);
        if summed is null then kept:=kept+1;
        else update public.list_items set quantity=summed where id=li.id returning * into li; merged:=merged+1; end if;
      end if;
      aliases:=aliases || jsonb_build_object(entry->>'clientId',li.id::text);
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
      update public.list_items set quantity=qty where id=li.id;
    elsif li.is_checked is distinct from (p_payload->>'checked')::boolean then
      if (p_payload->>'checked')::boolean then
        select count(*) filter(where is_checked),count(*) into already,total from public.list_items where list_id=p_list;
        record_route:=coalesce((p_payload->>'record')::boolean,true);
        update public.items set times_purchased=coalesce(times_purchased,0)+1,
          check_order_sum=coalesce(check_order_sum,0)+case when record_route then already+1 else 0 end,
          check_count=coalesce(check_count,0)+case when record_route then 1 else 0 end
          where id=li.item_id returning * into product;
        select store_id into shop from public.shopping_lists where id=p_list;
        if shop is not null and record_route and total>=3 then
          pos:=already::real/(total-1);
          insert into public.item_store_routes as r(household_id,item_id,store_id,avg_pos,n)
            values(p_household,li.item_id,shop,pos,1) on conflict(household_id,item_id,store_id) do update
            set avg_pos=r.avg_pos+(excluded.avg_pos-r.avg_pos)/least(r.n+1,8), n=r.n+1,updated_at=now();
          if product.section_id is not null then
            insert into public.section_store_routes as r(store_id,section_id,household_id,avg_pos,n)
              values(shop,product.section_id,p_household,pos,1) on conflict(store_id,section_id,household_id) do update
              set avg_pos=r.avg_pos+(excluded.avg_pos-r.avg_pos)/least(r.n+1,8),n=r.n+1,updated_at=now();
          end if;
        end if;
      end if;
      update public.list_items set is_checked=(p_payload->>'checked')::boolean,
        checked_at=case when (p_payload->>'checked')::boolean then now() else null end where id=li.id;
    end if;
  elsif kind='uncheck' then update public.list_items set is_checked=false,checked_at=null where list_id=p_list and is_checked;
  else raise exception 'Ugyldig operasjon'; end if;
  answer:=jsonb_build_object('aliases',aliases,'items',products,'added',added,'merged',merged,'restored',restored,'kept',kept,
    'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.list_items l where l.list_id=p_list and (kind='uncheck' or l.id=any(changed_ids))),
    'removed',case when kind='remove' then p_payload->>'listItemId' else null end);
  insert into public.list_write_receipts(household_id,operation_id,list_id,payload,result) values(p_household,p_operation,p_list,p_payload,answer);
  return answer;
end $$;

revoke all on function public.list_quantity_sum(text,text) from public, anon, authenticated;
revoke all on function public.apply_list_operation(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.list_quantity_sum(text,text) to service_role;
grant execute on function public.apply_list_operation(uuid,uuid,uuid,jsonb) to service_role;
commit;
