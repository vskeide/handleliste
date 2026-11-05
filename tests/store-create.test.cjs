const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

function actions({ loggedIn=true, admin=false, owner='household', failTable=null }={}) {
  const calls=[]
  const db={from(table) {
    const query={table,verb:'select',filters:{}}
    const chain={
      select(){return chain},eq(key,value){query.filters[key]=value;return chain},
      insert(payload){query.verb='insert';query.payload=payload;return chain},
      delete(){query.verb='delete';return chain},
      upsert(payload){query.verb='upsert';query.payload=payload;return chain},
      single(){return Promise.resolve(run())},
      then(resolve,reject){return Promise.resolve().then(run).then(resolve,reject)},
    }
    function run(){calls.push(query);return {error:query.verb==='insert'&&table===failTable?{code:'fixture'}:null,
      data:table==='stores'?{id:'store',mapped_by_household_id:owner,is_mapped:true}:null}}
    return chain
  }}
  const mocks={
    '@/lib/supabase/server':{createServiceRoleClient:()=>db},
    './auth':{getSession:async()=>loggedIn?'household':null,getHousehold:async()=>({is_admin:admin})},
    'next/cache':{revalidatePath(){}},
    '@/lib/constants':{STORE_CHAIN_LABELS:{KIWI:'KIWI',ANNA:'Anna'}},
  }
  const mod={exports:{}}
  const js=ts.transpileModule(fs.readFileSync('lib/actions/stores.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  new Function('require','module','exports',js)(id=>mocks[id]??require(id),mod,mod.exports)
  return {api:mod.exports,calls}
}
const input={name:'  KIWI Ulsteinvik  ',chain:'KIWI',city:' Ulsteinvik ',address:''}
test('new store belongs to the authenticated household and is immediately available to its list selector',async()=>{
  const {api,calls}=actions()
  const result=await api.createStore({...input,mapped_by_household_id:'another',is_mapped:true})
  assert.ok(result.storeId)
  assert.deepEqual(calls[0].payload,{id:result.storeId,name:'KIWI Ulsteinvik',chain:'KIWI',city:'Ulsteinvik',address:null,is_mapped:false,mapped_by_household_id:'household'})
  assert.deepEqual(calls[1].payload,{household_id:'household',store_id:result.storeId})
})
test('invalid or signed-out creation performs no database writes',async()=>{
  for(const bad of [null,{...input,city:''},{...input,name:'x'.repeat(101)},{...input,chain:'__proto__'},{...input,address:'x'.repeat(201)}]) {
    const {api,calls}=actions();assert.ok((await api.createStore(bad)).error);assert.equal(calls.length,0)
  }
  const {api,calls}=actions({loggedIn:false});assert.ok((await api.createStore(input)).error);assert.equal(calls.length,0)
})
test('failed household linking removes only the store created by that request',async()=>{
  const {api,calls}=actions({failTable:'household_stores'})
  assert.ok((await api.createStore(input)).error)
  assert.deepEqual(calls[2],{table:'stores',verb:'delete',filters:{id:calls[0].payload.id,mapped_by_household_id:'household'}})
  const failed=actions({failTable:'stores'});assert.ok((await failed.api.createStore(input)).error);assert.equal(failed.calls.length,1)
})
test('map permission allows the creator and admins, and refuses other households',async()=>{
  assert.equal(await actions().api.canEditSharedMap('store'),true)
  assert.equal(await actions({owner:'another'}).api.canEditSharedMap('store'),false)
  assert.equal(await actions({owner:'another',admin:true}).api.canEditSharedMap('store'),true)
  const map={grid_cols:24,grid_rows:28,entrance_position:{col:0,row:27},checkout_position:{col:23,row:27},blocks:[]}
  const refused=actions({owner:'another'})
  assert.equal((await refused.api.saveStoreMap('store',map)).error,'Ingen tilgang')
  assert.equal(refused.calls.some(c=>c.verb==='upsert'),false)
  for(const fixture of [actions(),actions({owner:'another',admin:true})]) {
    assert.equal((await fixture.api.saveStoreMap('store',map)).success,true)
    assert.equal(fixture.calls.filter(c=>c.verb==='upsert').length,1)
  }
})
