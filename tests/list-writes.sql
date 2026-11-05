-- Integration regression test for the Supabase connector execute_sql tool.
-- Fixtures are isolated to a new household and always rolled back, including on error.
begin;
do $test$
declare
  h uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); source uuid:=gen_random_uuid();
  product uuid:=gen_random_uuid(); line uuid:=gen_random_uuid(); op uuid:=gen_random_uuid(); alias_id uuid:=gen_random_uuid();
  payload jsonb; a jsonb; b jsonb; blocked boolean:=false;
begin
  insert into public.households(id,name,pin_hash,household_code) values(h,'Rollback-only regression fixture','not-a-login','TEST-'||h);
  insert into public.shopping_lists(id,household_id,name) values(l,h,'Target'),(source,h,'Previous');
  payload:=jsonb_build_object('kind','create','clientId',line,'itemId',product,'name','Testvare','sectionId',null,'quantity','2');
  a:=public.apply_list_operation(h,l,op,payload); b:=public.apply_list_operation(h,l,op,payload);
  if a<>b or (select count(*) from public.list_items where list_id=l)<>1 then raise exception 'Create replay failed'; end if;
  op:=gen_random_uuid(); payload:=jsonb_build_object('kind','qty','listItemId',line,'quantity','3');
  perform public.apply_list_operation(h,l,op,payload);
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','qty','listItemId',line,'quantity','5'));
  perform public.apply_list_operation(h,l,op,payload);
  if (select quantity from public.list_items where id=line)<>'5' then raise exception 'Old replay overwrote a newer edit'; end if;
  payload:=jsonb_build_object('kind','toggle','listItemId',line,'checked',true); op:=gen_random_uuid();
  perform public.apply_list_operation(h,l,op,payload); perform public.apply_list_operation(h,l,op,payload);
  perform public.apply_list_operation(h,l,gen_random_uuid(),payload);
  if (select times_purchased from public.items where id=product)<>1 then raise exception 'Tick counted twice'; end if;
  begin
    perform public.apply_list_operation(gen_random_uuid(),l,gen_random_uuid(),jsonb_build_object('kind','uncheck'));
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Ownership not enforced'; end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','uncheck'));
  if (select is_checked from public.list_items where id=line) then raise exception 'Uncheck failed'; end if;
  payload:=jsonb_build_object('kind','batch','lines',jsonb_build_array(
    jsonb_build_object('clientId',gen_random_uuid(),'itemId',alias_id,'create',true,'name','Testvare','sectionId',null,'quantity','2'),
    jsonb_build_object('clientId',gen_random_uuid(),'itemId',alias_id,'quantity','3')));
  op:=gen_random_uuid(); perform public.apply_list_operation(h,l,op,payload); perform public.apply_list_operation(h,l,op,payload);
  if (select quantity from public.list_items where id=line)<>'10' then raise exception 'Batch aliases or replay failed'; end if;
  insert into public.list_items(list_id,item_id,quantity) values(source,product,'1');
  op:=gen_random_uuid(); payload:=jsonb_build_object('kind','copy');
  perform public.apply_list_operation(h,l,op,payload); perform public.apply_list_operation(h,l,op,payload);
  if (select quantity from public.list_items where id=line)<>'11' then raise exception 'Copy replay failed'; end if;
  op:=gen_random_uuid();
  begin
    perform public.apply_list_operation(h,l,op,jsonb_build_object('kind','batch','lines',jsonb_build_array(
      jsonb_build_object('clientId',gen_random_uuid(),'itemId',product,'quantity','10'),
      jsonb_build_object('clientId',gen_random_uuid(),'itemId',gen_random_uuid(),'quantity','1'))));
    raise exception 'Expected rejection';
  exception when raise_exception then if SQLERRM='Expected rejection' then raise; end if; end;
  if (select quantity from public.list_items where id=line)<>'11' or exists(select 1 from public.list_write_receipts where household_id=h and operation_id=op)
    then raise exception 'Partial batch survived failure'; end if;
  if public.list_quantity_sum('500 g','1 kg')<>'1.5 kg' or public.list_quantity_sum('1,5 L','500 ml')<>'2 L'
    then raise exception 'Unit conversion failed'; end if;
  op:=gen_random_uuid(); payload:=jsonb_build_object('kind','remove','listItemId',line);
  perform public.apply_list_operation(h,l,op,payload); perform public.apply_list_operation(h,l,op,payload);
  if exists(select 1 from public.list_items where id=line) then raise exception 'Removal failed'; end if;
end $test$;
rollback;
select 'PASS: list-write integration tests; fixtures rolled back' as verification;
