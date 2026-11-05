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
