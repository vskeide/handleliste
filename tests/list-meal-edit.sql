-- Rollback-only integration checks for list-specific dinner editing.
begin;
do $test$
declare h uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); line uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); recipe uuid:=gen_random_uuid(); other_h uuid:=gen_random_uuid(); other_l uuid:=gen_random_uuid();
  op uuid; payload jsonb; answer jsonb; blocked boolean:=false;
  second_item uuid:=gen_random_uuid(); second_line uuid:=gen_random_uuid();
begin
  insert into public.households(id,name,pin_hash,household_code) values(h,'Meal edit regression fixture','not-a-login','TEST-'||h),(other_h,'Other meal fixture','not-a-login','TEST-'||other_h);
  insert into public.shopping_lists(id,household_id,name) values(l,h,'Meal edits'),(other_l,other_h,'Other list');
  insert into public.items(id,household_id,name) values(item,h,'Kjøtdeig');
  insert into public.meals(id,household_id,name,servings) values(recipe,h,'Saved taco',4);
  insert into public.meal_items(meal_id,item_id,quantity) values(recipe,item,'400 g');
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','add','clientId',line,'itemId',item,'quantity','100 g'));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','batch','meal',jsonb_build_object('id',a,'mealId',recipe,'name','Taco','servings',4),
    'lines',jsonb_build_array(jsonb_build_object('clientId',gen_random_uuid(),'itemId',item,'quantity','400 g'))));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','batch','meal',jsonb_build_object('id',b,'name','Lasagne','servings',4),
    'lines',jsonb_build_array(jsonb_build_object('clientId',gen_random_uuid(),'itemId',item,'quantity','500 g'))));
  op:=gen_random_uuid();payload:=jsonb_build_object('kind','mealServings','mealId',a,'servings',6);
  answer:=public.apply_list_operation(h,l,op,payload);perform public.apply_list_operation(h,l,op,payload);
  if (select quantity from public.list_items where id=line) is distinct from '1200 g' or (select servings from public.list_meals where id=a)<>6 then raise exception 'Shared scaling/replay failed';end if;
  if (select quantity from public.list_meal_ingredients where list_meal_id=b) is distinct from '500 g' then raise exception 'Other dinner changed';end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealQty','mealId',a,'itemId',item,'quantity','700 g'));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',3));
  if (select quantity from public.list_items where id=line) is distinct from '950 g' then raise exception 'Edited ingredient basis was ignored';end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',6));
  if (select quantity from public.list_items where id=line) is distinct from '1300 g' then raise exception 'Portion round trip drifted';end if;
  if (select servings from public.meals where id=recipe)<>4 or (select quantity from public.meal_items where meal_id=recipe) is distinct from '400 g' then raise exception 'Saved recipe changed';end if;

  -- Ownership and invalid shared-unit edits fail before leaving partial changes/receipts.
  begin perform public.apply_list_operation(other_h,other_l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',2));
    exception when invalid_parameter_value then blocked:=true;end;
  if not blocked then raise exception 'Other household edited dinner';end if;blocked:=false;
  op:=gen_random_uuid();
  begin perform public.apply_list_operation(h,l,op,jsonb_build_object('kind','mealQty','mealId',a,'itemId',item,'quantity','2'));
    exception when invalid_parameter_value then blocked:=true;end;
  if not blocked or exists(select 1 from public.list_write_receipts where household_id=h and operation_id=op) or
    (select quantity from public.list_items where id=line) is distinct from '1300 g' then raise exception 'Unit conflict left partial changes';end if;

  -- A normal-list override is preserved by later portion edits, not guessed into shares.
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','qty','listItemId',line,'quantity','2 kg'));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',2));
  if (select quantity from public.list_items where id=line) is distinct from '2 kg' then raise exception 'Manual override scaled';end if;
  -- Removed products are never silently re-added by a portion change.
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','remove','listItemId',line));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',4));
  if exists(select 1 from public.list_items where list_id=l) then raise exception 'Removed ingredient re-added';end if;

  -- A previously unknown portion count needs an explicit, checked starting count.
  a:=gen_random_uuid();line:=gen_random_uuid();
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','batch','meal',jsonb_build_object('id',a,'name','Unknown portions'),
    'lines',jsonb_build_array(jsonb_build_object('clientId',line,'itemId',item,'quantity','1 kg'))));
  blocked:=false;
  begin perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',2));
    exception when invalid_parameter_value then blocked:=true;end;
  if not blocked then raise exception 'Missing starting portions guessed';end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',2,'fromServings',4));
  if (select quantity from public.list_items where id=line) is distinct from '0.5 kg' then raise exception 'Explicit initial portions not used';end if;
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',3));
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','mealServings','mealId',a,'servings',4));
  if (select quantity from public.list_items where id=line) is distinct from '1 kg' then raise exception 'Fixed baseline drifted';end if;

  -- A conflict late in a multi-ingredient edit rolls every ingredient/basis back.
  insert into public.items(id,household_id,name) values(second_item,h,'Conflicting unit fixture');
  b:=gen_random_uuid();
  perform public.apply_list_operation(h,l,gen_random_uuid(),jsonb_build_object('kind','batch','meal',jsonb_build_object('id',b,'name','Atomic dinner','servings',4),
    'lines',jsonb_build_array(jsonb_build_object('clientId',gen_random_uuid(),'itemId',item,'quantity','400 g'),jsonb_build_object('clientId',second_line,'itemId',second_item,'quantity','500 g'))));
  update public.list_items set quantity='2' where id=second_line;
  op:=gen_random_uuid();blocked:=false;
  begin perform public.apply_list_operation(h,l,op,jsonb_build_object('kind','mealServings','mealId',b,'servings',2));exception when invalid_parameter_value then blocked:=true;end;
  if not blocked or (select servings from public.list_meals where id=b)<>4 or exists(select 1 from public.list_meal_ingredients where list_meal_id=b and base_quantity is not null)
    or (select quantity from public.list_meal_ingredients where list_meal_id=b and item_id=item) is distinct from '400 g'
    or exists(select 1 from public.list_write_receipts where household_id=h and operation_id=op) then raise exception 'Multi-ingredient edit was not atomic';end if;
  if public.list_quantity_scale('0.001 kg',4,2) is distinct from '0.0005 kg' then raise exception 'Small amount rounded incorrectly';end if;
end $test$;
rollback;
select 'PASS: shared scaling, ingredient edits, fixed bases, replay, saved-recipe preservation, ownership, atomic unit conflicts, overrides and removed ingredients; fixtures rolled back' as verification;
