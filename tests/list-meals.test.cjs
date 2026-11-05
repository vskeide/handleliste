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
const { subtractQty }=load('lib/quantity.ts')
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
