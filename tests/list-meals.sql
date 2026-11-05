-- Rollback-only fixtures. Run via the Supabase connector.
begin;
do $test$
declare h uuid:=gen_random_uuid(); other_h uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); other_list uuid:=gen_random_uuid();
  item uuid:=gen_random_uuid(); line uuid:=gen_random_uuid(); taco uuid:=gen_random_uuid(); lasagne uuid:=gen_random_uuid();
  recipe uuid:=gen_random_uuid(); op uuid; payload jsonb; result jsonb; blocked boolean:=false;
begin
  insert into public.households(id,name,pin_hash,household_code) values(h,'Meal source fixture','not-a-login','TEST-'||h),(other_h,'Other fixture','not-a-login','TEST-'||other_h);
  insert into public.shopping_lists(id,household_id,name) values(l,h,'Meal fixture'),(other_list,other_h,'Other fixture');
  insert into public.items(id,household_id,name) values(item,h,'Fixture meat');
  insert into public.meals(id,household_id,name,servings) values(recipe,h,'Saved taco',4);
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','add','clientId',line,'itemId',item,'quantity','100 g'));
  payload:=jsonb_build_object('kind','batch','meal',jsonb_build_object('id',taco,'mealId',recipe,'name','Taco','icon','🌮','servings',4),
    'lines',jsonb_build_array(jsonb_build_object('clientId',gen_random_uuid(),'itemId',item,'quantity','400 g')));
  op:=gen_random_uuid();perform public.apply_list_operation(h,l,op,payload);perform public.apply_list_operation(h,l,op,payload);
  if (select quantity from public.list_items where id=line) is distinct from '500 g' or (select count(*) from public.list_meals where list_id=l)<>1 then raise exception 'Meal replay failed';end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','batch','meal',jsonb_build_object('id',lasagne,'name','Lasagne','icon','🍽️','servings',4),
    'lines',jsonb_build_array(jsonb_build_object('clientId',gen_random_uuid(),'itemId',item,'quantity','500 g'))));
  result:=public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',taco));
  if (select quantity from public.list_items where id=line) is distinct from '600 g' or jsonb_array_length(result->'meals')<>1 then raise exception 'Shared/manual quantities lost';end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',lasagne,'itemId',item));
  if (select quantity from public.list_items where id=line) is distinct from '100 g' or not exists(select 1 from public.list_meals where id=lasagne) then raise exception 'Single-ingredient removal failed';end if;
  if not exists(select 1 from public.meals where id=recipe) then raise exception 'Saved recipe changed';end if;

  -- A manual edit safely detaches automatic quantity subtraction.
  perform public.apply_list_operation(h,l,gen_random_uuid(),payload);
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','qty','listItemId',line,'quantity','2 kg'));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',taco));
  if (select quantity from public.list_items where id=line) is distinct from '2 kg' then raise exception 'Manual override removed';end if;

  -- Whole-line removal detaches every source before a later addition.
  perform public.apply_list_operation(h,l,gen_random_uuid(),payload);
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','remove','listItemId',line));
  line:=gen_random_uuid();
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','add','clientId',line,'itemId',item,'quantity','600 g'));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',taco));
  if (select quantity from public.list_items where id=line) is distinct from '600 g' then raise exception 'Re-added ingredient removed';end if;

  -- Other households cannot read, remove or attach recipes from this household.
  begin perform public.get_list_contents(other_h,l);exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'Snapshot ownership failed';end if;blocked:=false;
  begin perform public.apply_list_operation(other_h,other_list,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',lasagne));exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'Meal ownership failed';end if;blocked:=false;
  begin perform public.apply_list_operation(other_h,other_list,gen_random_uuid(),payload||jsonb_build_object('meal',jsonb_build_object('id',gen_random_uuid(),'mealId',recipe,'name','Wrong')));exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'Recipe ownership failed';end if;

  -- Connector writes use the same source ledger and retry receipts.
  op:=gen_random_uuid();payload:=jsonb_build_object('meal_id',recipe,'list_id',l,'portions',2);
  result:=public.connector_write(h,op,'add_meal_to_list',payload,jsonb_build_object('kind','batch','lines',jsonb_build_array(jsonb_build_object('clientId',gen_random_uuid(),'itemId',item,'quantity','200 g'))));
  if not exists(select 1 from public.list_meals where id=op and list_id=l and servings=2) then raise exception 'Connector dinner missing';end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',op));
  if (select quantity from public.list_items where id=line) is distinct from '600 g' then raise exception 'Connector dinner removal failed';end if;
  if public.list_quantity_difference('1,5 L','500 ml')<>'1 L' or public.list_quantity_difference('2','400 g') is not null then raise exception 'Quantity subtraction failed';end if;

  -- When this dinner owns the entire line, removal returns the deleted line ID.
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','remove','listItemId',line));
  payload:=jsonb_build_object('kind','batch','meal',jsonb_build_object('id',taco,'name','Taco','icon','🌮','servings',4),
    'lines',jsonb_build_array(jsonb_build_object('clientId',line,'itemId',item,'quantity','400 g')));
  perform public.apply_list_operation(h,l,gen_random_uuid(),payload);
  result:=public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',taco));
  if exists(select 1 from public.list_items where id=line) or not (result->'removedIds' @> to_jsonb(array[line])) then raise exception 'Whole owned line not removed';end if;
  -- Concurrent removal by another household member is a safe no-op.
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',taco));

  -- Reusing a picked line for a new visit must detach the previous dinner.
  perform public.apply_list_operation(h,l,gen_random_uuid(),payload);
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','toggle','listItemId',line,'checked',true,'record',false));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','batch','meal',jsonb_build_object('id',gen_random_uuid(),'name','New trip'),
    'lines',jsonb_build_array(jsonb_build_object('clientId',gen_random_uuid(),'itemId',item,'quantity','500 g'))));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealRemove','mealId',taco));
  if (select quantity from public.list_items where id=line) is distinct from '500 g' then raise exception 'Old dinner removed new trip amount';end if;
  if public.list_quantity_difference('etter smak','etter smak')<>'0' then raise exception 'Exact free-form source could not be removed';end if;
end $test$;
rollback;
select 'PASS: meal add/replay, shared/manual amounts, partial removal, overrides, re-additions, ownership, connector and unit conversion; fixtures rolled back' as verification;
