// End-to-end HTTP check against a LOCAL preview, using isolated disposable DB rows.
// Never calls an AI API or follows external OAuth redirects. Never prints tokens.
import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const base = process.env.CONNECTOR_TEST_BASE || 'http://127.0.0.1:3012'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only local previews may be tested')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const households = [], clients = []
let checks = 0
const ok = (name) => { checks++; console.log(`PASS ${name}`) }
const checkError = (error) => { if (error) throw new Error(`Fixture database operation failed (${error.code || 'network'})`) }
async function http(path, options = {}) { return fetch(`${base}${path}`, { ...options, redirect: 'manual' }) }
async function jsonPost(path, data, authorization) {
  return http(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(data) })
}
function session(id) {
  const signature = createHmac('sha256', process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY).update(`household:${id}`).digest('base64url')
  return `handleliste_session=${id}.${signature}`
}
async function grant(client, household, scope, metadata, audience) {
  const verifier = randomBytes(32).toString('base64url'), state = randomUUID()
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: audience, scope, state })
  const path = `/connect/authorize?${params}`, cookie = session(household)
  const page = await http(path, { headers: { Cookie: cookie } }), html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /Godkjenn tilkopling/)
  const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)
  assert.ok(action, 'Consent form must expose a Next server action')
  const form = new FormData()
  form.set(action[1], ''); form.set('request', params.toString()); form.set('decision', 'approve')
  const consent = await http(path, { method: 'POST', headers: { Cookie: cookie, Origin: base }, body: form })
  assert.equal(consent.status, 303)
  const callback = new URL(consent.headers.get('location'))
  assert.equal(callback.origin, new URL(client.redirect_uris[0]).origin)
  assert.equal(callback.searchParams.get('state'), state)
  assert.equal(callback.searchParams.get('iss'), metadata.issuer)
  const code = callback.searchParams.get('code')
  assert.ok(code)
  const body = { client_id: client.client_id, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: audience }
  // A wrong verifier cannot consume the code.
  const wrong = await http('/api/connector/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, code_verifier: randomBytes(32).toString('base64url') }) })
  assert.equal(wrong.status, 400)
  const response = await http('/api/connector/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  assert.equal(response.status, 200)
  const tokens = await response.json()
  assert.ok(tokens.access_token && tokens.refresh_token)
  const replay = await http('/api/connector/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  assert.equal(replay.status, 400)
  return tokens
}
async function rpc(access, method, params = {}) {
  const response = await jsonPost('/mcp', { jsonrpc: '2.0', id: randomUUID(), method, params }, access)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.error, undefined)
  return result.result
}
async function tool(access, name, args) {
  const result = await rpc(access, 'tools/call', { name, arguments: args })
  assert.ok(!result.isError, result.content?.[0]?.text)
  return result.structuredContent
}

try {
  const anonymous = await http('/mcp')
  assert.equal(anonymous.status, 401)
  assert.match(anonymous.headers.get('www-authenticate'), /resource_metadata=/)
  const metadata = await (await http('/.well-known/oauth-authorization-server')).json()
  const resource = await (await http('/.well-known/oauth-protected-resource/mcp')).json()
  assert.equal(resource.authorization_servers[0], metadata.issuer)
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
  ok('OAuth discovery and unauthenticated MCP challenge')

  const invalid = await jsonPost('/api/connector/register', { redirect_uris: ['http://attacker.invalid/callback'] })
  assert.equal(invalid.status, 400)
  const registration = await jsonPost('/api/connector/register', { client_name: 'Connector HTTP test', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'none' })
  assert.equal(registration.status, 201)
  const client = await registration.json(); clients.push(client.client_id)
  for (let n = 0; n < 2; n++) {
    const { data, error } = await db.from('households').insert({ name: `Connector isolated test ${randomUUID()}`, household_code: `TEST-${randomUUID()}`, pin_hash: 'integration-test-not-a-login', adults: 2, children: 0, family_size: 2 }).select('id').single()
    checkError(error); households.push(data.id)
  }
  const { data: lists, error: listError } = await db.from('shopping_lists').insert([
    { household_id: households[0], name: 'Connector test A' }, { household_id: households[0], name: 'Connector test B' },
    { household_id: households[1], name: 'Foreign household test' },
  ]).select('id, household_id, name')
  checkError(listError)
  const listA = lists.find(l => l.name === 'Connector test A').id, listB = lists.find(l => l.name === 'Connector test B').id
  const foreignList = lists.find(l => l.household_id === households[1]).id
  const tokens = await grant(client, households[0], 'lists:read lists:write meals:write', metadata, resource.resource)
  ok('Registration, real consent form, PKCE, issuer/state preservation and single-use code')

  const initialized = await rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'check', version: '1' } })
  assert.equal(initialized.protocolVersion, '2025-11-25')
  assert.equal((await rpc(tokens.access_token, 'tools/list')).tools.length, 6)
  assert.equal((await tool(tokens.access_token, 'list_lists', {})).lists.length, 2)
  const denied = await rpc(tokens.access_token, 'tools/call', { name: 'get_list', arguments: { list_id: foreignList } })
  assert.equal(denied.isError, true)
  const foreignWrite = await rpc(tokens.access_token, 'tools/call', { name: 'add_items', arguments: { list_id: foreignList, request_id: randomUUID(), items: [{ name: 'Testvare', quantity: '1' }] } })
  assert.equal(foreignWrite.isError, true)
  ok('MCP handshake, tool discovery, list selection and household isolation')

  const addition = { list_id: listA, request_id: randomUUID(), items: [{ name: 'Connector testvare', quantity: '2' }] }
  const first = await tool(tokens.access_token, 'add_items', addition)
  assert.equal(first.added, 1)
  assert.deepEqual(await tool(tokens.access_token, 'add_items', addition), first)
  assert.equal((await tool(tokens.access_token, 'get_list', { list_id: listA })).list.list_items[0].quantity, '2')
  const changed = await rpc(tokens.access_token, 'tools/call', { name: 'add_items', arguments: { ...addition, items: [{ name: 'Connector testvare', quantity: '3' }] } })
  assert.equal(changed.isError, true)
  assert.equal((await tool(tokens.access_token, 'get_list', { list_id: listB })).list.list_items.length, 0)
  ok('Adding to a specific list, idempotent replay, changed-payload refusal')

  const recipe = { name: 'Connector testmiddag', servings: 4, ingredients: [{ name: 'Connector testvare', quantity: '250 g' }],
    recipe_text: 'Testinstruksjon. Ingen AI-kall.', source_url: 'https://example.com/recipe', list_id: listB, request_id: randomUUID() }
  const saved = await tool(tokens.access_token, 'save_meal', recipe)
  assert.ok(saved.meal_id)
  assert.deepEqual(await tool(tokens.access_token, 'save_meal', recipe), saved)
  const { data: savedMeal, error: mealError } = await db.from('meals').select('source_url, recipe_text, meal_items(quantity)').eq('id', saved.meal_id).single()
  checkError(mealError)
  assert.equal(savedMeal.meal_items[0].quantity, '250 g')
  assert.equal(savedMeal.source_url, recipe.source_url)
  assert.equal((await tool(tokens.access_token, 'get_list', { list_id: listB })).list.list_items[0].quantity, '125 g')
  assert.equal((await tool(tokens.access_token, 'list_meals', {})).meals.length, 1)
  await tool(tokens.access_token, 'add_meal_to_list', { list_id: listB, meal_id: saved.meal_id, portions: 4, request_id: randomUUID() })
  assert.equal((await tool(tokens.access_token, 'get_list', { list_id: listB })).list.list_items[0].quantity, '375 g')
  ok('Save recipe with source/instructions, preserve recipe amounts, scale and add to selected list')

  const readOnly = await grant(client, households[0], 'lists:read', metadata, resource.resource)
  assert.equal((await rpc(readOnly.access_token, 'tools/list')).tools.length, 3)
  const noWrite = await rpc(readOnly.access_token, 'tools/call', { name: 'add_items', arguments: { ...addition, request_id: randomUUID() } })
  assert.equal(noWrite.isError, true)
  ok('Read-only scopes cannot write')

  for (const publishedId of ['https://chatgpt.com/oauth/client.json', 'https://claude.ai/oauth/mcp-oauth-client-metadata']) {
    const { data: existingPublished, error: publishedError } = await db.from('connector_clients').select('id').eq('id', publishedId).maybeSingle()
    checkError(publishedError)
    // This is public provider metadata, not an AI API request.
    const published = await (await fetch(publishedId, { redirect: 'error' })).json()
    if (!existingPublished) clients.push(publishedId)
    const publishedTokens = await grant(published, households[0], 'lists:read', metadata, resource.resource)
    assert.equal((await tool(publishedTokens.access_token, 'list_lists', {})).lists.length, 2)
    ok(`${publishedId.includes('claude.ai') ? 'Claude' : 'ChatGPT'} published client identity works without manual registration`)
  }

  const rotate = async refresh_token => http('/api/connector/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id: client.client_id, resource: resource.resource }) })
  const changedScope = await http('/api/connector/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id, resource: resource.resource, scope: 'lists:read' }) })
  assert.equal(changedScope.status, 400)
  // A refused scope change must not consume or rotate the existing credential.
  assert.equal((await tool(tokens.access_token, 'list_lists', {})).lists.length, 2)
  checkError((await db.from('connector_connections').update({ access_expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq('household_id', households[0]).eq('access_hash', createHash('sha256').update(tokens.access_token).digest('hex'))).error)
  assert.equal((await http('/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 401)
  const refresh = await rotate(tokens.refresh_token)
  assert.equal(refresh.status, 200)
  const rotated = await refresh.json()
  assert.equal((await rotate(tokens.refresh_token)).status, 400)
  assert.equal((await http('/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 401)
  const revoked = await http('/api/connector/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.client_id, token: rotated.access_token }) })
  assert.equal(revoked.status, 200)
  assert.equal((await http('/mcp', { headers: { Authorization: `Bearer ${rotated.access_token}` } })).status, 401)
  assert.equal((await rotate(rotated.refresh_token)).status, 400)
  ok('Token expiry, refused scope changes, refresh rotation and immediate revocation')

  const badOrigin = await jsonPost('/mcp', {})
  assert.equal(badOrigin.status, 401)
  const blocked = await http('/mcp', { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(blocked.status, 403)
  const { data: secrets, error: secretError } = await db.from('connector_connections').select('access_hash, refresh_hash').eq('household_id', households[0])
  checkError(secretError)
  assert.ok(secrets.every(c => /^[0-9a-f]{64}$/.test(c.access_hash) && /^[0-9a-f]{64}$/.test(c.refresh_hash)))
  ok('Origin checks and hashed credential storage')
  console.log(`${checks} HTTP integration groups passed.`)
} finally {
  // IDs came only from this script's successful inserts; delete no pre-existing rows.
  for (const id of households) {
    checkError((await db.from('shopping_lists').delete().eq('household_id', id)).error)
    checkError((await db.from('meals').delete().eq('household_id', id)).error)
    checkError((await db.from('households').delete().eq('id', id)).error)
  }
  for (const id of clients) checkError((await db.from('connector_clients').delete().eq('id', id)).error)
  console.log('Isolated test households and OAuth clients removed.')
}
