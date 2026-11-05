const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Run the existing TS modules without adding another test framework. Server-action
// dependencies are replaced per test; these checks never contact the live database.
const root = path.resolve(__dirname, '..')
function loadTs(file, mocks = {}, cache = new Map()) {
  const full = path.resolve(root, file)
  if (cache.has(full)) return cache.get(full).exports
  const mod = { exports: {} }
  cache.set(full, mod)
  const js = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const localRequire = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id.startsWith('.') || id.startsWith('@/')) {
      let target = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(full), id)
      if (!path.extname(target)) target += '.ts'
      return loadTs(target, mocks, cache)
    }
    return require(id)
  }
  new Function('require', 'module', 'exports', js)(localRequire, mod, mod.exports)
  return mod.exports
}

function database(answer) {
  const calls = []
  return { calls, from(table) {
    const query = { table, verb: 'select', filters: {}, payload: undefined }
    const run = () => { calls.push(query); return answer(query) }
    const chain = {
      select() { return chain },
      eq(key, value) { query.filters[key] = value; return chain },
      in() { return chain },
      order() { return chain },
      insert(payload) { query.verb = 'insert'; query.payload = payload; return chain },
      update(payload) { query.verb = 'update'; query.payload = payload; return chain },
      upsert(payload) { query.verb = 'upsert'; query.payload = payload; return chain },
      single() { return Promise.resolve(run()) },
      maybeSingle() { return Promise.resolve(run()) },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject) },
    }
    return chain
  } }
}

function actions(file, db, loggedIn = true) {
  return loadTs(file, {
    '@/lib/supabase/server': { createServiceRoleClient: () => db },
    './auth': { getSession: async () => loggedIn ? 'household' : null, getHousehold: async () => ({ is_admin: true }) },
    'next/cache': { revalidatePath() {} },
    '@/lib/ownership': { ownsList: async () => true, ownsMeal: async () => true },
  })
}

test('decimal commas survive entry splitting, including multiple ingredients', () => {
  const { splitEntries, parseEntry, isMultiEntry } = loadTs('lib/parse-list.ts')
  assert.deepEqual(splitEntries('1,5 L mjølk, 0,5 kg potet og 3 egg'), ['1,5 L mjølk', '0,5 kg potet', '3 egg'])
  assert.deepEqual(parseEntry(splitEntries('1,5 L mjølk')[0]), { name: 'mjølk', quantity: '1.5 L' })
  assert.equal(isMultiEntry('1,5 L mjølk'), false)
  assert.deepEqual(splitEntries('mjølk,egg;smør\n½ kg potet'), ['mjølk', 'egg', 'smør', '½ kg potet'])
})

test('compatible units add without turning decimal amounts into pieces', () => {
  const { parseQty, addQty } = loadTs('lib/quantity.ts')
  assert.deepEqual(parseQty('1,5 L'), { amount: 1.5, unit: 'L' })
  assert.equal(addQty('500 g', '1 kg'), '1.5 kg')
  assert.equal(addQty('500 g', '2'), null)
})

test('catalogue and starter meals have unique names, known sections and parseable quantities', () => {
  const { CATALOG } = loadTs('lib/catalog-data.ts')
  const { STARTER_MEALS } = loadTs('lib/starter-meals.ts')
  const sections = new Set(['Baking', 'Barnemat & bleier', 'Brød & bakeri', 'Drikke', 'Frukt & grønt', 'Frysevarer', 'Hermetikk', 'Hushaldning', 'Kaffi', 'Kjøt & fisk', 'Meieri', 'Pålegg & frukost', 'Pasta', 'Personleg pleie', 'Reinhald', 'Snacks & godteri', 'Taco mm.', 'Tørrvarer'])
  const qty = /^\d+(?:\.\d+)?(?: (?:stk|g|kg|dl|L|ml|pakke|porsjon))?$/
  assert.equal(new Set(CATALOG.map(p => p.name.toLocaleLowerCase('nn'))).size, CATALOG.length)
  for (const p of CATALOG) {
    assert.ok(sections.has(p.section), `${p.name}: unknown section ${p.section}`)
    if (p.qty) assert.match(p.qty, qty, p.name)
  }
  assert.equal(new Set(STARTER_MEALS.map(m => m.name)).size, STARTER_MEALS.length)
  for (const meal of STARTER_MEALS) {
    assert.ok(meal.servings > 0 && meal.ingredients.length > 0, meal.name)
    for (const ingredient of meal.ingredients) assert.match(ingredient.qty, qty, `${meal.name}: ${ingredient.name}`)
  }
})

test('failed list refresh preserves the current screen instead of returning empty data', async () => {
  const db = database(() => ({ data: null, error: { message: 'Unavailable' } }))
  assert.equal(await actions('lib/actions/lists.ts', db).getListItems('list'), null)
})

test('a successful empty-list read is still an empty array', async () => {
  const db = database(() => ({ data: [], error: null }))
  assert.deepEqual(await actions('lib/actions/lists.ts', db).getListItems('list'), [])
})

test('list edits cannot reassign ownership or overwrite server-maintained fields', async () => {
  const db = database(() => ({ error: null }))
  await actions('lib/actions/lists.ts', db).updateList('list', { name: '  Handel  ', household_id: 'other', id: 'other-list' })
  assert.deepEqual(db.calls[0].payload, { name: 'Handel' })
  assert.equal(db.calls[0].filters.household_id, 'household')
})

test('meal edits restrict fields and report database failures', async () => {
  const db = database(() => ({ error: { message: 'Unavailable' } }))
  const result = await actions('lib/actions/meals.ts', db).updateMeal('meal', { name: ' Taco ', household_id: 'other' })
  assert.deepEqual(db.calls[0].payload, { name: 'Taco' })
  assert.ok(result.error)
})

test('merge reports a read failure and performs no writes', async () => {
  const db = database(() => ({ data: null, error: { message: 'Unavailable' } }))
  const { mergeIntoList } = loadTs('lib/list-merge.ts')
  const result = await mergeIntoList(db, 'list', [{ item_id: 'item', quantity: '2' }])
  assert.ok(result.error)
  assert.deepEqual(db.calls.map(q => q.verb), ['select'])
})

for (const verb of ['insert', 'update']) {
  test(`merge reports ${verb} failures instead of a success count`, async () => {
    const db = database(q => q.verb === 'select'
      ? { data: verb === 'update' ? [{ id: 'line', item_id: 'item', quantity: '1', is_checked: false }] : [], error: null }
      : { error: { message: 'Unavailable' } })
    const { mergeIntoList } = loadTs('lib/list-merge.ts')
    assert.ok((await mergeIntoList(db, 'list', [{ item_id: 'item', quantity: '2' }])).error)
  })
}

const map = () => ({ grid_cols: 24, grid_rows: 28, entrance_position: { col: 0, row: 27 }, checkout_position: { col: 23, row: 27 },
  blocks: [{ section_id: '11111111-1111-4111-8111-111111111111', col: 2, row: 2, width: 3, height: 4 }] })

test('invalid maps are rejected before querying or saving', async () => {
  const db = database(() => { throw new Error('Must not reach database') })
  const invalid = map(); invalid.blocks[0].width = 100
  assert.ok((await actions('lib/actions/stores.ts', db).saveStoreMap('store', invalid)).error)
  assert.equal(db.calls.length, 0)
})

test('map saves restrict fields and surface a failed write', async () => {
  const db = database(q => q.table === 'stores' ? { data: { is_mapped: true }, error: null } : { error: { message: 'Unavailable' } })
  const result = await actions('lib/actions/stores.ts', db).saveStoreMap('store', { ...map(), store_id: 'other', id: 'other-map' })
  assert.ok(result.error)
  const write = db.calls.find(q => q.verb === 'upsert')
  assert.equal(write.payload.store_id, 'store')
  assert.equal(write.payload.id, undefined)
})

test('map reads require a session', async () => {
  const db = database(() => { throw new Error('Must not reach database') })
  assert.equal(await actions('lib/actions/stores.ts', db, false).getStoreMap('store'), null)
  assert.equal(db.calls.length, 0)
})

function memoryStorage() {
  const values = new Map()
  return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }
}
const outboxModule = () => loadTs('lib/list-outbox.ts')

test('clearing a list persists all removals together and resumes after an interrupted sync', async () => {
  const { ListOutbox, overlayWrites } = outboxModule()
  const storage = memoryStorage(); let saves = 0
  const q = new ListOutbox('queue', { ...storage, setItem(k,v) { saves++; storage.setItem(k,v) } }, () => {})
  // Include a not-yet-synced addition and an already picked line.
  q.enqueue({ kind:'add', clientId:'temporary', itemId:'item' })
  const lines = [{id:'picked',item_id:'picked',is_checked:true}, {id:'temporary',item_id:'item',is_checked:false}]
  const before = saves
  q.enqueueMany(lines.map(l => ({kind:'remove',listItemId:l.id})))
  assert.equal(saves,before+1)
  assert.deepEqual(overlayWrites(lines,q.entries,'list'),[])
  await q.flush(async w => {
    if(w.op.kind==='add') return {aliases:{temporary:'confirmed'}}
    throw new Error('Offline')
  }, () => {}, () => {})
  const restored = new ListOutbox('queue',storage,()=>{}); restored.restore()
  assert.equal(restored.entries.length,2)
  const sent=[]
  await restored.flush(async w => {sent.push(w.op.listItemId);return {}},()=>{},()=>{})
  assert.deepEqual(sent,['picked','confirmed'])
  assert.equal(restored.entries.length,0)
  // Clear targets the confirmed snapshot, preserving additions from another phone.
  const confirmed = lines.map(l=>({...l,id:l.id==='temporary'?'confirmed':l.id}))
  assert.deepEqual(overlayWrites([...confirmed,{id:'later',item_id:'later'}],q.entries,'list').map(l=>l.id),['later'])
})

test('online writes are serial and dependent operations use the confirmed line ID', async () => {
  const { ListOutbox } = outboxModule()
  const q = new ListOutbox('queue', memoryStorage(), () => {})
  q.enqueue({ kind: 'create', clientId: 'temporary', itemId: 'item', name: 'Test', sectionId: 'section' })
  let release; const gate = new Promise(resolve => { release = resolve })
  const sent = []; let running = 0; let peak = 0
  const run = async write => {
    peak = Math.max(peak, ++running); sent.push(write)
    if (write.op.kind === 'create') await gate
    running--
    return { aliases: { temporary: 'confirmed' } }
  }
  const first = q.flush(run, () => {}, () => {})
  q.enqueue({ kind: 'qty', listItemId: 'temporary', quantity: '3' })
  await q.flush(run, () => {}, () => {})
  assert.equal(sent.length, 1)
  release(); await first
  assert.equal(peak, 1)
  assert.equal(sent[1].op.listItemId, 'confirmed')
  assert.equal(q.entries.length, 0)
})

test('a response lost after commit retries the persisted request ID after reload', async () => {
  const { ListOutbox } = outboxModule(); const storage = memoryStorage()
  const q = new ListOutbox('queue', storage, () => {})
  q.enqueue({ kind: 'add', itemId: 'item', clientId: 'line', name: 'Egg' })
  const original = q.entries[0].id
  const receipts = new Map(); let applied = 0
  await q.flush(async write => { receipts.set(write.id, { aliases: {} }); applied++; throw new Error('Response lost') }, () => {}, () => {})
  assert.equal(q.entries.length, 1)
  const restored = new ListOutbox('queue', storage, () => {}); restored.restore()
  assert.equal(restored.entries[0].id, original)
  await restored.flush(async write => receipts.get(write.id) ?? (applied++, { aliases: {} }), () => {}, () => {})
  assert.equal(applied, 1)
  assert.equal(restored.entries.length, 0)
})

test('server refusals remain queued until retry or explicit discard', async () => {
  const { ListOutbox } = outboxModule(); const storage = memoryStorage()
  const q = new ListOutbox('queue', storage, () => {})
  q.enqueue({ kind: 'remove', listItemId: 'line' })
  let acknowledged = 0
  await q.flush(async () => ({ error: 'Refused' }), () => acknowledged++, () => {})
  assert.equal(q.entries.length, 1); assert.equal(q.error, 'Refused'); assert.equal(acknowledged, 0)
  q.retry()
  await q.flush(async () => ({}), () => acknowledged++, () => {})
  assert.equal(acknowledged, 1); assert.equal(q.entries.length, 0)
  q.enqueue({ kind: 'qty', listItemId: 'line', quantity: '4' })
  await q.flush(async () => ({ error: 'Refused' }), () => {}, () => {})
  q.discard()
  assert.equal(q.entries.length, 0); assert.equal(q.error, null); assert.equal(storage.getItem('queue'), null)
})

test('polling cannot overwrite pending ticks, quantities or removals', () => {
  const { overlayWrites } = outboxModule()
  const line = id => ({ id, item_id: id, list_id: 'list', quantity: '1', is_checked: false, checked_at: null, sort_override: null, created_at: '' })
  const base = [line('a'), line('b'), line('c')]
  const pending = [
    { id: '1', op: { kind: 'toggle', listItemId: 'a', checked: true } },
    { id: '2', op: { kind: 'qty', listItemId: 'b', quantity: '7' } },
    { id: '3', op: { kind: 'remove', listItemId: 'c' } },
  ]
  const visible = overlayWrites(base, pending, 'list')
  assert.equal(visible[0].is_checked, true); assert.equal(visible[1].quantity, '7'); assert.equal(visible.length, 2)
  assert.equal(base[0].is_checked, false)
})

test('batch overlays do not add quantities twice when polling sees an unacknowledged commit', () => {
  const { overlayWrites } = outboxModule()
  const line = { id: 'line', item_id: 'item', list_id: 'list', quantity: '5', is_checked: false }
  const pending = [{ id: 'op', op: { kind: 'batch', lines: [{ clientId: 'temp', itemId: 'item', quantity: '3', optimisticQuantity: '5' }] } }]
  assert.equal(overlayWrites([line], pending, 'list')[0].quantity, '5')
})

test('legacy queue import persists stable IDs and product names survive reload', () => {
  const { ListOutbox } = outboxModule(); const storage = memoryStorage()
  storage.setItem('queue', JSON.stringify([{ kind: 'create', clientId: 'line', itemId: 'item', name: 'Potet', sectionId: 'section' }]))
  const q = new ListOutbox('queue', storage, () => {}); q.restore()
  const again = new ListOutbox('queue', storage, () => {}); again.restore()
  assert.equal(again.entries[0].id, q.entries[0].id)
  assert.equal(again.entries[0].op.name, 'Potet')
})

test('corrupt queue storage is reported without deleting it', () => {
  const { ListOutbox } = outboxModule(); const storage = memoryStorage()
  storage.setItem('queue', '[{"op":null}]')
  const q = new ListOutbox('queue', storage, () => {}); q.restore()
  assert.ok(q.error); assert.equal(storage.getItem('queue'), '[{"op":null}]')
})

test('storage-full failure blocks sending an operation that is not safely persisted', async () => {
  const { ListOutbox } = outboxModule()
  const q = new ListOutbox('queue', { getItem: () => null, setItem() { throw new Error('Full') }, removeItem() {} }, () => {})
  q.enqueue({ kind: 'remove', listItemId: 'line' })
  let calls = 0
  await q.flush(async () => { calls++; return {} }, () => {}, () => {})
  assert.ok(q.error); assert.equal(calls, 0); assert.equal(q.entries.length, 1)
})

test('storage filling during an in-flight request stops subsequent unpersisted writes', async () => {
  const { ListOutbox } = outboxModule(); const storage = memoryStorage(); let full = false
  const q = new ListOutbox('queue', { ...storage, setItem(k,v) { if (full) throw new Error('Full'); storage.setItem(k,v) } }, () => {})
  q.enqueue({ kind: 'qty', listItemId: 'line', quantity: '2' })
  let release; const gate = new Promise(resolve => { release=resolve }); let calls=0
  const flight = q.flush(async () => { calls++; await gate; return {} }, () => {}, () => {})
  full=true; q.enqueue({ kind: 'qty', listItemId: 'line', quantity: '3' }); release(); await flight
  assert.equal(calls,1); assert.equal(q.entries.length,1); assert.ok(q.error)
})

test('leaving the page during a request retains the operation for receipt-safe retry', async () => {
  const { ListOutbox } = outboxModule(); const storage=memoryStorage()
  const q = new ListOutbox('queue', storage, () => {})
  q.enqueue({ kind: 'qty', listItemId: 'line', quantity: '2' })
  let release; const gate = new Promise(resolve => { release=resolve })
  const flight=q.flush(async () => { await gate; return {} }, () => { throw new Error('Unmounted callback') }, () => {})
  const id=q.entries[0].id; q.stop(); release(); await flight
  const restored=new ListOutbox('queue', storage, () => {}); restored.restore()
  assert.equal(restored.entries[0].id,id)
})

test('async session APIs preserve existing signed cookies and reject tampering', async () => {
  const previous=process.env.SESSION_SECRET; process.env.SESSION_SECRET='test-only-secret'
  try {
    const expected=`household.${require('node:crypto').createHmac('sha256','test-only-secret').update('household:household').digest('base64url')}`
    const writes=[]
    const session=loadTs('lib/session.ts', {
      'next/headers': { cookies: async () => ({ get: () => ({ value: expected }), set: (...args) => writes.push(args) }) },
      'next/navigation': { redirect() { throw new Error('Unexpected redirect') } },
    })
    assert.equal(await session.readSession(),'household')
    assert.equal(await session.requireSession(),'household')
    assert.equal(session.decodeSession(expected+'x'),null)
    await session.writeSession('household')
    assert.equal(writes[0][1],expected)
  } finally { if (previous===undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET=previous }
})
