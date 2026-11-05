-- Relative order replaces absolute "fraction of the whole list" learning.
-- Historical averages remain intact for old clients, but new clients do not read them.
begin;
alter table public.list_items add column if not exists route_store_id uuid references public.stores(id) on delete set null;
alter table public.list_items add column if not exists route_picked_at timestamptz;

create table if not exists public.item_route_pairs (
  household_id uuid not null references public.households(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  a_id uuid not null references public.items(id) on delete cascade,
  b_id uuid not null references public.items(id) on delete cascade,
  a_before_b real not null check(a_before_b between 0 and 1),
  n integer not null default 1 check(n>0),
  updated_at timestamptz not null default now(),
  primary key(household_id,store_id,a_id,b_id), check(a_id<b_id)
);
create table if not exists public.section_route_pairs (
  household_id uuid not null references public.households(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  a_id uuid not null references public.sections(id) on delete cascade,
  b_id uuid not null references public.sections(id) on delete cascade,
  a_before_b real not null check(a_before_b between 0 and 1),
  n integer not null default 1 check(n>0),
  updated_at timestamptz not null default now(),
  primary key(store_id,household_id,a_id,b_id), check(a_id<b_id)
);
alter table public.item_route_pairs enable row level security;
alter table public.section_route_pairs enable row level security;
revoke all on public.item_route_pairs,public.section_route_pairs from public,anon,authenticated;
grant all on public.item_route_pairs,public.section_route_pairs to service_role;

create or replace function public.record_relative_pick(p_household uuid,p_line uuid,p_picked_at timestamptz default null)
returns void language plpgsql security invoker set search_path=public,pg_catalog as $$
declare target record; previous record; a uuid; b uuid; score real; picked_at timestamptz;
begin
  select li.id,li.list_id,li.item_id,i.section_id,sl.store_id into target
  from public.list_items li join public.shopping_lists sl on sl.id=li.list_id join public.items i on i.id=li.item_id
  where li.id=p_line and sl.household_id=p_household and li.is_checked;
  if not found then raise exception 'Ingen tilgang' using errcode='42501'; end if;
  if target.store_id is null then return; end if;
  picked_at:=coalesce(p_picked_at,now());
  if picked_at>now()+interval '5 minutes' or picked_at<now()-interval '30 days' then picked_at:=now(); end if;
  update public.list_items set route_store_id=target.store_id,route_picked_at=picked_at where id=p_line;
  -- Compare nearby observed picks only. Carry-over ticks from earlier trips/shops
  -- and every unpicked product are excluded, independently of list length.
  for previous in
    select item_id,route_picked_at from public.list_items where list_id=target.list_id and id<>p_line and is_checked
      and route_store_id=target.store_id and route_picked_at between picked_at-interval '90 minutes' and picked_at+interval '90 minutes'
    order by abs(extract(epoch from route_picked_at-picked_at)),id limit 12
  loop
    a:=least(previous.item_id,target.item_id); b:=greatest(previous.item_id,target.item_id);
    if a=b then continue; end if;
    score:=case when (previous.route_picked_at<=picked_at and a=previous.item_id)
      or (previous.route_picked_at>picked_at and a=target.item_id) then 1 else 0 end;
    insert into public.item_route_pairs as r(household_id,store_id,a_id,b_id,a_before_b,n)
      values(p_household,target.store_id,a,b,score,1) on conflict(household_id,store_id,a_id,b_id)
      do update set a_before_b=r.a_before_b+(excluded.a_before_b-r.a_before_b)/least(r.n+1,8),n=r.n+1,updated_at=now();
  end loop;
  -- A section contributes on first arrival, avoiding repeated votes from a large aisle
  -- and avoiding a contradictory vote when walking back for one forgotten product.
  if target.section_id is not null and not exists(
    select 1 from public.list_items li join public.items i on i.id=li.item_id where li.list_id=target.list_id and li.id<>p_line
      and li.is_checked and li.route_store_id=target.store_id and i.section_id=target.section_id
      and li.route_picked_at between picked_at-interval '90 minutes' and picked_at
  ) then
    for previous in
      select i.section_id,min(li.route_picked_at) as first_pick from public.list_items li join public.items i on i.id=li.item_id
      where li.list_id=target.list_id and li.id<>p_line and li.is_checked and li.route_store_id=target.store_id
        and i.section_id is not null and i.section_id<>target.section_id
        and li.route_picked_at between picked_at-interval '90 minutes' and picked_at+interval '90 minutes'
      group by i.section_id
      order by i.section_id
    loop
      a:=least(previous.section_id,target.section_id); b:=greatest(previous.section_id,target.section_id);
      score:=case when (previous.first_pick<=picked_at and a=previous.section_id)
        or (previous.first_pick>picked_at and a=target.section_id) then 1 else 0 end;
      insert into public.section_route_pairs as r(household_id,store_id,a_id,b_id,a_before_b,n)
        values(p_household,target.store_id,a,b,score,1) on conflict(store_id,household_id,a_id,b_id)
        do update set a_before_b=r.a_before_b+(excluded.a_before_b-r.a_before_b)/least(r.n+1,8),n=r.n+1,updated_at=now();
    end loop;
  end if;
end $$;
revoke all on function public.record_relative_pick(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_relative_pick(uuid,uuid,timestamptz) to service_role;

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

      end if;
      update public.list_items set is_checked=(p_payload->>'checked')::boolean,
        checked_at=case when (p_payload->>'checked')::boolean then now() else null end,route_store_id=null,route_picked_at=null where id=li.id;
      if (p_payload->>'checked')::boolean and record_route then
        perform public.record_relative_pick(p_household,li.id,(p_payload->>'pickedAt')::timestamptz);
      end if;
    end if;
  elsif kind='uncheck' then update public.list_items set is_checked=false,checked_at=null where list_id=p_list and is_checked;
  else raise exception 'Ugyldig operasjon'; end if;
  answer:=jsonb_build_object('aliases',aliases,'items',products,'added',added,'merged',merged,'restored',restored,'kept',kept,
    'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.list_items l where l.list_id=p_list and (kind='uncheck' or l.id=any(changed_ids))),
    'removed',case when kind='remove' then p_payload->>'listItemId' else null end);
  insert into public.list_write_receipts(household_id,operation_id,list_id,payload,result) values(p_household,p_operation,p_list,p_payload,answer);
  return answer;
end $$;

revoke all on function public.apply_list_operation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_list_operation(uuid,uuid,uuid,jsonb) to service_role;
commit;
