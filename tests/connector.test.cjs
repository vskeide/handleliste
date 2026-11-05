const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { generateKeyPairSync, sign } = require('node:crypto')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
function load(file, mocks = {}, cache = new Map()) {
  const full = path.resolve(root, file)
  if (cache.has(full)) return cache.get(full).exports
  const mod = { exports: {} }; cache.set(full, mod)
  const js = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const local = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id.startsWith('.') || id.startsWith('@/')) return load((id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(full), id)) + '.ts', mocks, cache)
    return require(id)
  }
  new Function('require', 'module', 'exports', js)(local, mod, mod.exports)
  return mod.exports
}
const security = load('lib/connector/security.ts')
const tools = load('lib/connector/tools.ts')
const list = '11111111-1111-4111-8111-111111111111'
const add = () => ({ list_id: list, request_id: 'one-user-action', items: [{ name: 'Egg', quantity: '6' }] })

test('PKCE S256 matches the published RFC 7636 test vector', () => {
  assert.equal(security.challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})
test('tokens have 256 bits of randomness and are not stored in their hash', () => {
  const value = security.token()
  assert.match(value, /^[A-Za-z0-9_-]{43}$/)
  assert.match(security.hash(value), /^[0-9a-f]{64}$/)
  assert.notEqual(security.token(), value)
  assert.equal(security.equalSecret('abc', 'abc'), true)
  assert.equal(security.equalSecret('abc', 'abcd'), false)
})
test('request identities are stable, valid UUIDs and isolated per connection and action', () => {
  const value = security.operationId('connection-a', 'add_items', 'request')
  assert.match(value, security.UUID)
  assert.equal(value, security.operationId('connection-a', 'add_items', 'request'))
  assert.notEqual(value, security.operationId('connection-b', 'add_items', 'request'))
  assert.notEqual(value, security.operationId('connection-a', 'save_meal', 'request'))
})
test('callbacks must be explicit HTTPS URLs without fragments or embedded credentials', () => {
  assert.equal(security.validRedirect('https://claude.ai/api/mcp/auth_callback'), true)
  for (const value of ['http://example.com/callback', 'https://user:pass@example.com/cb', 'https://example.com/cb#code', 'javascript:alert(1)', '/relative']) assert.equal(security.validRedirect(value), false)
})
test('permissions are canonical and reject unknown scopes', () => {
  assert.equal(security.scopes('lists:write lists:read lists:read'), 'lists:read lists:write')
  assert.throws(() => security.scopes('admin'), /Unknown permission/)
})
test('tools require explicit list IDs and reject unknown or prototype-named fields', () => {
  assert.deepEqual(tools.validateInput('add_items', add()), add())
  assert.throws(() => tools.validateInput('add_items', { ...add(), list_id: 'Vekohandel' }))
  assert.throws(() => tools.validateInput('add_items', { ...add(), household_id: list }))
  assert.throws(() => tools.validateInput('list_lists', JSON.parse('{"constructor":"unexpected"}')))
  const missing = add(); delete missing.list_id
  assert.throws(() => tools.validateInput('add_items', missing))
})
test('ingredient validation rejects invalid amounts, oversized batches and non-product properties', () => {
  for (const quantity of ['-2', '0', 'NaN kg', '2 unknown', '100001', 'etter smak']) assert.throws(() => tools.validateInput('add_items', { ...add(), items: [{ name: 'Egg', quantity }] }))
  assert.doesNotThrow(() => tools.validateInput('add_items', { ...add(), items: [{ name: 'Mjølk', quantity: '1,5 L' }] }))
  assert.throws(() => tools.validateInput('add_items', { ...add(), items: Array(101).fill({ name: 'Egg' }) }))
  assert.throws(() => tools.validateInput('add_items', { ...add(), items: [{ name: 'Egg', sectionId: list }] }))
})
test('recipe input supports a selected list while rejecting executable URLs and invalid portions', () => {
  const meal = { name: 'Taco', servings: 4, ingredients: [{ name: 'Tomat', quantity: '250 g' }], request_id: 'save', list_id: list, source_url: 'https://example.com/recipe' }
  assert.doesNotThrow(() => tools.validateInput('save_meal', meal))
  assert.throws(() => tools.validateInput('save_meal', { ...meal, source_url: 'javascript:alert(1)' }))
  assert.throws(() => tools.validateInput('save_meal', { ...meal, servings: 0 }))
  assert.throws(() => tools.validateInput('save_meal', { ...meal, portions: Infinity }))
})
test('connector recipe scaling reduces quantities without the old half-kilo minimum', () => {
  assert.equal(tools.scaleExact('0.25 kg', 0.5), '125 g')
  assert.equal(tools.scaleExact('250 g', 0.5), '125 g')
})
test('scopes are checked before accessing the database, including save-and-add', async () => {
  const connection = { id: 'connection', household_id: list, scope: 'lists:read' }
  await assert.rejects(() => tools.callTool('add_items', add(), connection), /Reconnect/)
  await assert.rejects(() => tools.callTool('save_meal', { name: 'Taco', servings: 4, ingredients: [{ name: 'Tomat' }], request_id: 'save', list_id: list }, { ...connection, scope: 'meals:write' }), /Reconnect/)
})
test('oversized request streams stop before parsing', async () => {
  const request = new Request('https://example.com', { method: 'POST', body: 'x'.repeat(100) })
  await assert.rejects(() => security.bodyText(request, 20), /Request too large/)
})

test('published identity URLs cannot target arbitrary hosts, ports, credentials or redirects', () => {
  const { trustedIdentityUrl } = load('lib/connector/published-client.ts')
  assert.equal(trustedIdentityUrl('https://chatgpt.com/oauth/client.json'), true)
  assert.equal(trustedIdentityUrl('https://claude.ai/api/oauth/mcp-oauth-client-metadata'), true)
  for (const value of ['https://127.0.0.1/oauth/client', 'https://chatgpt.com.attacker.invalid/oauth/client', 'https://chatgpt.com:444/oauth/client', 'https://chatgpt.com/oauth/client?url=http://localhost', 'https://user@chatgpt.com/oauth/client', 'https://chatgpt.com/settings']) assert.equal(trustedIdentityUrl(value), false)
})
test('published client assertions require valid RSA signatures, claims and endpoint audience', async () => {
  const { verifyAssertion, assertionClaims } = load('lib/connector/published-client.ts')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }
  const client = { client_id: 'https://chatgpt.com/oauth/client.json', jwks_uri: 'https://chatgpt.com/oauth/test-keys.json', methods: ['private_key_jwt'] }
  const claims = { iss: client.client_id, sub: client.client_id, aud: `${security.origin()}/api/connector/token`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+120, jti: 'one-use-assertion' }
  const jwt = value => {
    const prefix = [ { alg: 'RS256', kid: 'test-key' }, value ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')
    return `${prefix}.${sign('RSA-SHA256', Buffer.from(prefix), privateKey).toString('base64url')}`
  }
  const previous = global.fetch
  global.fetch = async url => { assert.equal(url, client.jwks_uri); return Response.json({ keys: [jwk] }) }
  try {
    assert.equal(await verifyAssertion(jwt(claims), client), claims.jti)
    const withoutIssuedAt = { ...claims }; delete withoutIssuedAt.iat
    assert.equal(await verifyAssertion(jwt(withoutIssuedAt), client), claims.jti)
    await assert.rejects(() => verifyAssertion(jwt({ ...claims, exp: claims.iat-1 }), client), /expired/)
    await assert.rejects(() => verifyAssertion(jwt({ ...claims, sub: 'other' }), client), /Invalid/)
    await assert.rejects(() => verifyAssertion(jwt({ ...claims, aud: 'https://attacker.invalid' }), client), /Invalid/)
    assert.throws(() => assertionClaims(jwt({ ...claims, aud: `${security.origin()}/api/connector/revoke` }), client.client_id), /Invalid/)
    const signed = jwt(claims), pieces = signed.split('.')
    pieces[2] = Buffer.alloc(256).toString('base64url')
    await assert.rejects(() => verifyAssertion(pieces.join('.'), client), /signature/)
  } finally { global.fetch = previous }
})

test('service worker bypasses authorization pages and purges only cached connector pages', async () => {
  const listeners = {}, removed = [], cache = { keys: async () => [new Request('https://example.com/connect/authorize'), new Request('https://example.com/lister/my-list')], delete: async request => { removed.push(request.url); return true } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8'), {
    URL, Promise, self: { location: { origin: 'https://example.com' }, addEventListener: (name, fn) => { listeners[name] = fn }, clients: { claim: async () => {} } },
    caches: { keys: async () => ['pages-v1'], open: async () => cache, delete: async () => true },
  })
  for (const pathname of ['/connect', '/connect/authorize', '/mcp', '/api/connector/token', '/.well-known/oauth-authorization-server', '/innstillingar/assistentar']) {
    listeners.fetch({ request: { method: 'GET', url: `https://example.com${pathname}`, mode: 'navigate' }, respondWith() { assert.fail(`Must not cache ${pathname}`) } })
  }
  let cleanup
  listeners.activate({ waitUntil(promise) { cleanup = promise } })
  await cleanup
  assert.deepEqual(removed, ['https://example.com/connect/authorize'])
})
