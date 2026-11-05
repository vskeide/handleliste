import { createPublicKey, verify } from 'node:crypto'
import { bodyText, ConnectorError, origin, validRedirect } from './security'

interface PublishedClient {
  client_id: string; name: string; redirect_uris: string[]; methods: string[]; jwks_uri?: string
}
const documents = new Map<string, { expires: number; value: PublishedClient }>()
const keys = new Map<string, { expires: number; value: Record<string, any>[] }>()

// Only these providers are supported. Never fetch arbitrary client_id/jwks URLs:
// that would turn the public authorization/token endpoints into an SSRF proxy.
export function trustedIdentityUrl(value: string, host?: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['chatgpt.com', 'claude.ai'].includes(url.hostname)
      && (!host || url.hostname === host) && !url.port && !url.username && !url.password && !url.search && !url.hash
      && /^\/(?:api\/)?oauth\/[^/].*/.test(url.pathname)
  } catch { return false }
}
async function fetchDocument(url: string) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) throw new ConnectorError('invalid_client', 'Published client identity is unavailable', 401)
  return JSON.parse(await bodyText(response, 20000))
}
export async function publishedClient(id: string): Promise<PublishedClient> {
  if (!trustedIdentityUrl(id)) throw new ConnectorError('invalid_client', 'Unsupported published client identity', 401)
  const cached = documents.get(id)
  if (cached && cached.expires > Date.now()) return cached.value
  const document = await fetchDocument(id), host = new URL(id).hostname
  if (document.client_id !== id || !Array.isArray(document.redirect_uris) || document.redirect_uris.length < 1 || document.redirect_uris.length > 10
    || document.redirect_uris.some((uri: unknown) => !validRedirect(uri) || new URL(uri as string).hostname !== host)) {
    throw new ConnectorError('invalid_client', 'Invalid published client metadata', 401)
  }
  const methods = document.token_endpoint_auth_methods_supported || [document.token_endpoint_auth_method || 'none']
  if (!Array.isArray(methods) || !methods.some((method: string) => ['none', 'private_key_jwt'].includes(method))) throw new ConnectorError('invalid_client', 'Unsupported client authentication', 401)
  if (methods.includes('private_key_jwt') && (!document.jwks_uri || !trustedIdentityUrl(document.jwks_uri, host))) throw new ConnectorError('invalid_client', 'Invalid signing key URL', 401)
  const value = { client_id: id, name: host === 'chatgpt.com' ? 'ChatGPT' : 'Claude', redirect_uris: document.redirect_uris,
    methods: methods.filter((method: string) => ['none', 'private_key_jwt'].includes(method)), jwks_uri: document.jwks_uri }
  if (documents.size >= 100) documents.clear()
  documents.set(id, { expires: Date.now() + 300000, value })
  return value
}
export function assertionClaims(assertion: string, clientId: string, endpoint = '/api/connector/token') {
  if (assertion.length > 12000) throw new ConnectorError('invalid_client', 'Invalid client assertion', 401)
  const pieces = assertion.split('.')
  if (pieces.length !== 3 || pieces.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new ConnectorError('invalid_client', 'Invalid client assertion', 401)
  let header, claims
  try { header = JSON.parse(Buffer.from(pieces[0], 'base64url').toString()); claims = JSON.parse(Buffer.from(pieces[1], 'base64url').toString()) }
  catch { throw new ConnectorError('invalid_client', 'Invalid client assertion', 401) }
  const now = Date.now() / 1000, audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 200 || header.crit
    || claims.iss !== clientId || claims.sub !== clientId || !audiences.some((aud: unknown) => aud === `${origin()}${endpoint}` || aud === origin())
    || typeof claims.exp !== 'number' || claims.exp <= now || claims.exp > now + 600
    || (claims.iat !== undefined && (typeof claims.iat !== 'number' || claims.iat > now + 60 || claims.iat < now - 600))
    || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 60))
    || typeof claims.jti !== 'string' || !claims.jti || claims.jti.length > 200) throw new ConnectorError('invalid_client', 'Invalid or expired client assertion', 401)
  return { pieces, header, claims }
}
export async function verifyAssertion(assertion: string, client: PublishedClient, endpoint = '/api/connector/token') {
  const decoded = assertionClaims(assertion, client.client_id, endpoint)
  if (!client.jwks_uri) throw new ConnectorError('invalid_client', 'No signing keys configured', 401)
  let cached = keys.get(client.jwks_uri)
  // Unknown kid triggers one refresh to allow provider signing-key rotation.
  if (!cached || cached.expires <= Date.now() || !cached.value.some(key => key.kid === decoded.header.kid)) {
    const document = await fetchDocument(client.jwks_uri)
    if (!Array.isArray(document.keys) || document.keys.length > 20) throw new ConnectorError('invalid_client', 'Invalid signing keys', 401)
    cached = { expires: Date.now() + 300000, value: document.keys }
    if (keys.size >= 100) keys.clear()
    keys.set(client.jwks_uri, cached)
  }
  const key = cached.value.find(key => key.kid === decoded.header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'))
  if (!key || typeof key.n !== 'string' || Buffer.from(key.n, 'base64url').length < 256) throw new ConnectorError('invalid_client', 'Unknown signing key', 401)
  let valid = false
  try { valid = verify('RSA-SHA256', Buffer.from(`${decoded.pieces[0]}.${decoded.pieces[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(decoded.pieces[2], 'base64url')) }
  catch { /* Invalid keys/signatures are authentication failures. */ }
  if (!valid) throw new ConnectorError('invalid_client', 'Invalid client signature', 401)
  return decoded.claims.jti as string
}
