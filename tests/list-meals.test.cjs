const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
function load(file) {
  const mod={exports:{}}
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  new Function('module','exports','require',js)(mod,mod.exports,id=>load(path.join(path.dirname(file),id+'.ts')))
  return mod.exports
}
const { overlayListContents }=load('lib/list-meals.ts')
const { subtractQty,scaleMealQty,replaceMealQty }=load('lib/quantity.ts')
const line=(id,quantity,checked=false)=>({id,item_id:id,list_id:'list',quantity,is_checked:checked,checked_at:null,sort_override:null,created_at:''})
const meal=(id,quantity,item='meat')=>({id,name:id,icon:'🍽️',servings:4,ingredients:[{item_id:item,list_item_id:item,name:item,quantity}]})
const remove=(id,itemId)=>({id:'op-'+id,op:{kind:'mealRemove',mealId:id,...(itemId?{itemId}:{})}})

test('removing a dinner preserves quantities from another dinner and manual shopping',()=>{
  const base=[line('meat','1 kg')], meals=[meal('taco','400 g'),meal('lasagne','500 g')]
  const r=overlayListContents(base,meals,[remove('taco')],'list')
  assert.equal(r.lines[0].quantity,'600 g');assert.deepEqual(r.meals.map(m=>m.id),['lasagne'])
  const next=overlayListContents(r.lines,r.meals,[remove('lasagne','meat')],'list')
  assert.equal(next.lines[0].quantity,'100 g');assert.equal(next.meals[0].ingredients.length,0)
  assert.equal(base[0].quantity,'1 kg');assert.equal(meals[0].ingredients.length,1)
})
test('removing one ingredient leaves the dinner and its other ingredients intact',()=>{
  const m=meal('taco','400 g');m.ingredients.push({item_id:'onion',list_item_id:'onion',name:'Lauk',quantity:'2'})
  const r=overlayListContents([line('meat','400 g'),line('onion','2')],[m],[remove('taco','meat')],'list')
  assert.deepEqual(r.lines.map(l=>l.id),['onion']);assert.equal(r.meals[0].ingredients[0].item_id,'onion')
})
test('manual quantity overrides are preserved when removing the dinner',()=>{
  const r=overlayListContents([line('meat','900 g')],[meal('taco','400 g'),meal('lasagne','500 g')],[
    {id:'edit',op:{kind:'qty',listItemId:'meat',quantity:'2 kg'}},remove('taco'),remove('lasagne')],'list')
  assert.equal(r.lines[0].quantity,'2 kg');assert.equal(r.meals.length,0)
})
test('manual ingredient removal does not remove it twice or affect a later re-addition',()=>{
  const r=overlayListContents([line('meat','400 g')],[meal('taco','400 g')],[
    {id:'delete',op:{kind:'remove',listItemId:'meat'}},
    {id:'add',op:{kind:'add',itemId:'meat',clientId:'new',quantity:'600 g'}},remove('taco')],'list')
  assert.equal(r.lines[0].quantity,'600 g');assert.equal(r.meals.length,0)
})
test('offline dinner add, partial removal and a later independent add retain their source amounts',()=>{
  const r=overlayListContents([line('meat','100 g')],[],[
    {id:'add-meal',op:{kind:'batch',meal:{id:'taco',name:'Taco',icon:'🌮',servings:4},lines:[{itemId:'meat',clientId:'temp',name:'Kjøtdeig',quantity:'400 g',optimisticQuantity:'500 g'}]}},
    {id:'more',op:{kind:'batch',lines:[{itemId:'meat',clientId:'temp2',quantity:'500 g',optimisticQuantity:'1 kg'}]}},remove('taco')],'list')
  assert.equal(r.lines[0].quantity,'600 g');assert.equal(r.meals.length,0)
})
test('incompatible units never claim ownership of an existing ingredient',()=>{
  const r=overlayListContents([line('meat','2')],[],[
    {id:'add',op:{kind:'batch',meal:{id:'taco',name:'Taco',icon:'🌮',servings:4},lines:[{itemId:'meat',clientId:'temp',quantity:'400 g'}]}},remove('taco')],'list')
  assert.equal(r.lines[0].quantity,'2')
})
test('reusing a checked line starts a new source and leaves the previous dinner harmless',()=>{
  const r=overlayListContents([line('meat','400 g',true)],[meal('old','400 g')],[
    {id:'add',op:{kind:'batch',meal:{id:'new',name:'New',icon:'🍽️',servings:2},lines:[{itemId:'meat',clientId:'temp',quantity:'500 g'}]}},remove('old')],'list')
  assert.equal(r.lines[0].quantity,'500 g');assert.equal(r.lines[0].is_checked,false)
})
test('subtraction converts compatible units and refuses to guess free-form quantities',()=>{
  assert.equal(subtractQty('1,5 L','500 ml'),'1 L');assert.equal(subtractQty('900 g','400 g'),'500 g')
  assert.equal(subtractQty('400 g','400 g'),'0');assert.equal(subtractQty('2','500 g'),null)
  assert.equal(subtractQty('etter smak','1'),null)
  assert.equal(subtractQty('etter smak','etter smak'),'0');assert.equal(subtractQty('2','0'),'2')
})

test('polling a committed dinner cannot duplicate its source before acknowledgement',()=>{
  const r=overlayListContents([line('meat','900 g')],[meal('taco','400 g'),meal('lasagne','500 g')],[
    {id:'lost-response',op:{kind:'batch',meal:{id:'taco',name:'Taco',icon:'🌮',servings:4},lines:[{itemId:'meat',clientId:'temp',quantity:'400 g',optimisticQuantity:'400 g'}]}},remove('taco')],'list')
  assert.equal(r.lines[0].quantity,'500 g');assert.deepEqual(r.meals.map(m=>m.id),['lasagne'])
})

const portions=(id,servings,fromServings)=>({id:'portion-op',op:{kind:'mealServings',mealId:id,servings,...(fromServings?{fromServings}:{})}})
const quantity=(id,itemId,q)=>({id:'quantity-op',op:{kind:'mealQty',mealId:id,itemId,quantity:q}})
test('portion changes preserve other dinners and manual purchases while leaving input snapshots untouched',()=>{
  const meals=[meal('taco','400 g'),meal('lasagne','500 g')],base=[line('meat','1 kg')]
  const r=overlayListContents(base,meals,[portions('taco',6)],'list')
  assert.equal(r.lines[0].quantity,'1200 g');assert.equal(r.meals[0].servings,6);assert.equal(r.meals[0].ingredients[0].quantity,'600 g')
  assert.equal(r.meals[1].ingredients[0].quantity,'500 g');assert.equal(base[0].quantity,'1 kg');assert.equal(meals[0].servings,4)
})
test('repeated portion changes and a refreshed committed result do not drift or apply twice',()=>{
  const r=overlayListContents([line('meat','1 kg')],[meal('taco','1 kg')],[portions('taco',3),portions('taco',4)],'list')
  assert.equal(r.lines[0].quantity,'1 kg');assert.equal(r.meals[0].ingredients[0].base_quantity,'1 kg')
  const applied=overlayListContents(r.lines,r.meals,[portions('taco',3)],'list')
  const replay=overlayListContents(applied.lines,applied.meals,[portions('taco',3)],'list')
  assert.equal(replay.lines[0].quantity,applied.lines[0].quantity)
})
test('a dinner ingredient quantity edit creates a new portion basis and later deletion preserves the rest',()=>{
  const r=overlayListContents([line('meat','1 kg')],[meal('taco','400 g'),meal('lasagne','500 g')],[quantity('taco','meat','700 g'),portions('taco',2)],'list')
  assert.equal(r.lines[0].quantity,'950 g');assert.equal(r.meals[0].ingredients[0].quantity,'350 g')
  const removed=overlayListContents(r.lines,r.meals,[remove('taco')],'list')
  assert.equal(removed.lines[0].quantity,'600 g')
})
test('scaling does not restore removed ingredients or change globally overridden quantities',()=>{
  const m=meal('taco','400 g');m.ingredients.push({item_id:'salt',list_item_id:null,name:'Salt',quantity:'1'})
  const r=overlayListContents([line('meat','400 g')],[m],[{id:'override',op:{kind:'qty',listItemId:'meat',quantity:'2 kg'}},portions('taco',2)],'list')
  assert.equal(r.lines[0].quantity,'2 kg');assert.equal(r.lines.length,1);assert.equal(r.meals[0].servings,2)
})
test('unknown portions require an explicit starting count before changing the list',()=>{
  const m={...meal('taco','400 g'),servings:null}
  assert.equal(overlayListContents([line('meat','400 g')],[m],[portions('taco',2)],'list').lines[0].quantity,'400 g')
  assert.equal(overlayListContents([line('meat','400 g')],[m],[portions('taco',2,4)],'list').lines[0].quantity,'200 g')
})
test('a unit conflict rejects the entire projected portion change',()=>{
  const m=meal('taco','400 g');m.ingredients.push({item_id:'onion',list_item_id:'onion',name:'Onion',quantity:'500 g'})
  const r=overlayListContents([line('meat','400 g'),line('onion','2')],[m],[portions('taco',2)],'list')
  assert.equal(r.lines[0].quantity,'400 g');assert.equal(r.meals[0].servings,4)
  assert.equal(replaceMealQty('900 g','400 g','2'),null)
  assert.equal(replaceMealQty('400 g','400 g','2'),'2')
  assert.equal(replaceMealQty('300 g','400 g','500 g'),null)
  assert.equal(scaleMealQty('1,5 L',4,2),'0.75 L')
  assert.equal(scaleMealQty('0.001 kg',4,2),'0.0005 kg')
})
