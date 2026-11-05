-- Run with the Supabase execute_sql connector. Only rollback-only fixtures are used.
begin;
do $test$
declare h uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); l uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); ignored uuid:=gen_random_uuid();
  sa uuid:=gen_random_uuid(); sb uuid:=gen_random_uuid(); la uuid:=gen_random_uuid(); lb uuid:=gen_random_uuid(); lc uuid:=gen_random_uuid();
  pair_score real; pair_n int; t0 timestamptz:=now()-interval '10 minutes'; request_id uuid; payload jsonb;
begin
  insert into public.households(id,name,pin_hash,household_code) values(h,'Relative-route regression fixture','not-a-login','TEST-'||h);
  insert into public.stores(id,name,chain,city) values(shop,'Relative-route fixture','TEST','TEST');
  insert into public.sections(id,name_nn,icon,color,default_sort_order) values(sa,'Fixture A','A','#000000',1),(sb,'Fixture B','B','#000000',2);
  insert into public.shopping_lists(id,household_id,name,store_id) values(l,h,'Partial trip',shop);
  insert into public.items(id,household_id,name,section_id) values(a,h,'A',sa),(b,h,'B',sb),(c,h,'C',sb),(ignored,h,'Unpicked',sa);
  insert into public.list_items(id,list_id,item_id,quantity) values(la,l,a,'1'),(lb,l,b,'1'),(lc,l,c,'1'),(gen_random_uuid(),l,ignored,'1');
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','toggle','listItemId',la,'checked',true,'pickedAt',t0));
  request_id:=gen_random_uuid(); payload:=jsonb_build_object('kind','toggle','listItemId',lb,'checked',true,'pickedAt',t0+interval '1 minute');
  perform public.apply_list_operation(h,l,request_id,payload); perform public.apply_list_operation(h,l,request_id,payload);
  select a_before_b,n into pair_score,pair_n from public.item_route_pairs where household_id=h and a_id=least(a,b) and b_id=greatest(a,b);
  if pair_n is distinct from 1 or pair_score is distinct from (case when a<b then 1 else 0 end) then raise exception 'Partial trip order or retry failed'; end if;
  if exists(select 1 from public.item_route_pairs where household_id=h and (a_id=ignored or b_id=ignored)) then raise exception 'Unpicked product affected learning'; end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','toggle','listItemId',lc,'checked',true,'pickedAt',t0+interval '2 minutes'));
  if (select n from public.section_route_pairs where household_id=h)<>1 then raise exception 'Large section gained repeated votes'; end if;

  -- A later trip must not learn from the previous day's carry-over checked items.
  update public.list_items set route_picked_at=now()-interval '1 day' where list_id=l;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','toggle','listItemId',lc,'checked',false));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','toggle','listItemId',lc,'checked',true,'pickedAt',now()));
  if (select n from public.item_route_pairs where household_id=h and a_id=least(a,c) and b_id=greatest(a,c))<>1 then raise exception 'Old checked item polluted a later visit'; end if;

  -- Simulate offline devices syncing in reverse arrival order, using capture times.
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','uncheck'));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','toggle','listItemId',lb,'checked',true,'pickedAt',t0+interval '1 minute'));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','toggle','listItemId',la,'checked',true,'pickedAt',t0));
  select a_before_b,n into pair_score,pair_n from public.item_route_pairs where household_id=h and a_id=least(a,b) and b_id=greatest(a,b);
  if pair_n is distinct from 2 or pair_score is distinct from (case when a<b then 1 else 0 end) then raise exception 'Offline arrival order overwrote captured pick order'; end if;

  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','toggle','listItemId',lc,'checked',true,'record',false,'pickedAt',now()));
  if (select route_picked_at from public.list_items where id=lc) is not null then raise exception 'Non-shopping tick taught a route'; end if;
end $test$;
rollback;
select 'PASS: partial trip, unpicked products, replay, section balance, carry-over, offline capture time and home ticks; fixtures rolled back' as verification;
