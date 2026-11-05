import { createServiceRoleClient } from '@/lib/supabase/server'
import { challenge, ConnectorError, equalSecret, hash, resource, scopes, token, validRedirect } from './security'
import { publishedClient, verifyAssertion } from './published-client'

export interface AuthorizationRequest {
  client_id: string; redirect_uri: string; response_type: string; code_challenge: string
  code_challenge_method: string; resource: string; scope: string; state: string
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const { data, error } = await createServiceRoleClient().rpc('connector_rate_limit', { p_bucket: hash(key), p_limit: limit, p_seconds: seconds })
  if (error) throw new ConnectorError('temporarily_unavailable', 'Connector is not ready. Please try again shortly.', 503)
  if (!data) throw new ConnectorError('slow_down', 'Too many requests. Please try again later.', 429)
}
export async function validateAuthorization(params: URLSearchParams) {
  for (const key of ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'state']) {
    if (params.getAll(key).length > 1) throw new ConnectorError('invalid_request', 'Repeated authorization parameter')
  }
  const request: AuthorizationRequest = {
    client_id: params.get('client_id') || '', redirect_uri: params.get('redirect_uri') || '', response_type: params.get('response_type') || '',
    code_challenge: params.get('code_challenge') || '', code_challenge_method: params.get('code_challenge_method') || '',
    resource: params.get('resource') || resource(), scope: scopes(params.get('scope')), state: params.get('state') || '',
  }
  if (!request.client_id || request.client_id.length > 200 || !validRedirect(request.redirect_uri)) throw new ConnectorError('invalid_request', 'Invalid application or callback')
  if (request.response_type !== 'code' || request.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(request.code_challenge)
    || request.state.length > 2000 || request.resource !== resource()) throw new ConnectorError('invalid_request', 'Invalid authorization request')
  const db = createServiceRoleClient()
  if (request.client_id.startsWith('https://')) {
    const published = await publishedClient(request.client_id)
    const { error } = await db.from('connector_clients').upsert({ id: published.client_id, name: published.name,
      redirect_uris: published.redirect_uris, auth_method: published.methods.includes('none') ? 'none' : 'private_key_jwt', secret_hash: null })
    if (error) throw new ConnectorError('temporarily_unavailable', 'Please try again shortly', 503)
  }
  const { data: client, error } = await db.from('connector_clients').select('id, name, redirect_uris').eq('id', request.client_id).maybeSingle()
  if (error) throw new ConnectorError('temporarily_unavailable', 'Connector is not ready', 503)
  if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(request.redirect_uri)) throw new ConnectorError('invalid_request', 'Callback does not match the registered application')
  return { request, client }
}
export async function authenticateClient(request: Request, params: URLSearchParams) {
  let id = params.get('client_id') || '', secret = params.get('client_secret') || '', method = secret ? 'client_secret_post' : 'none'
  const authorization = request.headers.get('authorization')
  const assertion = params.get('client_assertion')
  if (assertion) {
    if (authorization || secret || params.get('client_assertion_type') !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') throw new ConnectorError('invalid_client', 'Invalid client authentication', 401)
    method = 'private_key_jwt'
  }
  if (authorization) {
    if (!authorization.startsWith('Basic ')) throw new ConnectorError('invalid_client', 'Invalid client authentication', 401)
    const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8')
    const at = credentials.indexOf(':')
    if (at < 1) throw new ConnectorError('invalid_client', 'Invalid client authentication', 401)
    const basicId = decodeURIComponent(credentials.slice(0, at)), basicSecret = decodeURIComponent(credentials.slice(at + 1))
    if (id && id !== basicId) throw new ConnectorError('invalid_client', 'Client mismatch', 401)
    id = basicId; secret = basicSecret; method = 'client_secret_basic'
  }
  if (!id || id.length > 200 || secret.length > 500) throw new ConnectorError('invalid_client', 'Invalid application', 401)
  const { data: client, error } = await createServiceRoleClient().from('connector_clients').select('id, auth_method, secret_hash').eq('id', id).maybeSingle()
  if (error) throw new ConnectorError('temporarily_unavailable', 'Please try again shortly', 503)
  if (client && id.startsWith('https://')) {
    const published = await publishedClient(id)
    if (!published.methods.includes(method)) throw new ConnectorError('invalid_client', 'Unsupported client authentication', 401)
    if (method === 'private_key_jwt') {
      const endpoint = new URL(request.url).pathname === '/api/connector/revoke' ? '/api/connector/revoke' : '/api/connector/token'
      const jti = await verifyAssertion(assertion!, published, endpoint)
      await rateLimit(`assertion:${id}:${jti}`, 1, 660)
    }
    return client
  }
  if (!client || client.auth_method !== method || (method !== 'none' && (!client.secret_hash || !equalSecret(hash(secret), client.secret_hash)))) {
    throw new ConnectorError('invalid_client', 'Invalid client authentication', 401)
  }
  return client
}
export async function exchangeToken(request: Request, params: URLSearchParams) {
  const client = await authenticateClient(request, params)
  const audience = params.get('resource') || resource()
  if (audience !== resource()) throw new ConnectorError('invalid_target', 'Unknown resource')
  const access = token(), refresh = token(), db = createServiceRoleClient()
  let result: { scope: string } | null = null
  if (params.get('grant_type') === 'authorization_code') {
    const code = params.get('code') || '', verifier = params.get('code_verifier') || ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new ConnectorError('invalid_grant', 'Invalid authorization code or verifier')
    const { data, error } = await db.rpc('connector_exchange_code', {
      p_hash: hash(code), p_client: client.id, p_redirect: params.get('redirect_uri') || '', p_challenge: challenge(verifier),
      p_resource: audience, p_access: hash(access), p_refresh: hash(refresh),
    })
    if (error) throw new ConnectorError('temporarily_unavailable', 'Please try again shortly', 503)
    result = data
  } else if (params.get('grant_type') === 'refresh_token') {
    const previous = params.get('refresh_token') || ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(previous)) throw new ConnectorError('invalid_grant', 'Invalid refresh token')
    let query = db.from('connector_connections').update({ access_hash: hash(access), refresh_hash: hash(refresh),
      access_expires_at: new Date(Date.now() + 3600000).toISOString() })
      .eq('client_id', client.id).eq('resource', audience).eq('refresh_hash', hash(previous)).is('revoked_at', null)
      .gt('refresh_expires_at', new Date().toISOString())
    if (params.get('scope')) query = query.eq('scope', scopes(params.get('scope')))
    const { data, error } = await query.select('scope').maybeSingle()
    if (error) throw new ConnectorError('temporarily_unavailable', 'Please try again shortly', 503)
    result = data
  } else throw new ConnectorError('unsupported_grant_type', 'Use authorization_code or refresh_token')
  if (!result) throw new ConnectorError('invalid_grant', 'Authorization expired, used, revoked or invalid')
  return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: result.scope }
}
export async function bearerConnection(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  if (!/^Bearer [A-Za-z0-9_-]{43}$/i.test(authorization)) return null
  const { data, error } = await createServiceRoleClient().from('connector_connections')
    .select('id, household_id, scope').eq('access_hash', hash(authorization.slice(7))).eq('resource', resource())
    .is('revoked_at', null).gt('access_expires_at', new Date().toISOString()).maybeSingle()
  if (error) throw new ConnectorError('temporarily_unavailable', 'Please try again shortly', 503)
  return data as { id: string; household_id: string; scope: string } | null
}
