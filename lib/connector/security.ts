import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const SCOPES = ['lists:read', 'lists:write', 'meals:write'] as const
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function origin() {
  const value = new URL(process.env.CONNECTOR_ORIGIN || 'https://handleliste-nine.vercel.app')
  if (value.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(value.hostname))) throw new Error('Invalid connector origin')
  return value.origin
}
export const resource = () => `${origin()}/mcp`
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const challenge = (value: string) => createHash('sha256').update(value).digest('base64url')
export const token = () => randomBytes(32).toString('base64url')
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
export function operationId(connection: string, tool: string, request: string) {
  const h = hash(JSON.stringify([connection, tool, request]))
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
export function validRedirect(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch { return false }
}
export function scopes(value: string | null) {
  const chosen = value?.trim() ? [...new Set(value.trim().split(/\s+/))] : [...SCOPES]
  if (chosen.some(s => !(SCOPES as readonly string[]).includes(s))) throw new ConnectorError('invalid_scope', 'Unknown permission')
  return SCOPES.filter(scope => chosen.includes(scope)).join(' ')
}
export class ConnectorError extends Error {
  scope?: string
  constructor(public code: string, message: string, public status = 400) { super(message) }
}
export function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}
export function errorResponse(error: unknown) {
  if (error instanceof ConnectorError) return json({ error: error.code, error_description: error.message }, error.status)
  console.error('Connector request failed') // Never log codes, bearer tokens or request bodies.
  return json({ error: 'temporarily_unavailable', error_description: 'Please try again shortly.' }, 503)
}
export async function bodyText(request: { body: ReadableStream<Uint8Array> | null }, limit = 100000) {
  const reader = request.body?.getReader()
  if (!reader) return ''
  let bytes = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.length
    if (bytes > limit) { await reader.cancel(); throw new ConnectorError('invalid_request', 'Request too large', 413) }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
export function authorizationMetadata() {
  const base = origin()
  return { issuer: base, authorization_endpoint: `${base}/connect/authorize`, token_endpoint: `${base}/api/connector/token`,
    registration_endpoint: `${base}/api/connector/register`, revocation_endpoint: `${base}/api/connector/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'private_key_jwt', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'], scopes_supported: SCOPES,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true }
}
export function resourceMetadata() {
  return { resource: resource(), authorization_servers: [origin()], scopes_supported: SCOPES,
    bearer_methods_supported: ['header'], resource_name: 'Handleliste', resource_documentation: `${origin()}/connect` }
}
