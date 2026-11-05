import { createServiceRoleClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/connector/auth'
import { bodyText, ConnectorError, errorResponse, hash, json, token, validRedirect } from '@/lib/connector/security'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    await rateLimit(`registration:${request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown'}`, 30, 3600)
    await rateLimit('registration-global', 100, 86400)
    if (!request.headers.get('content-type')?.includes('application/json')) throw new ConnectorError('invalid_client_metadata', 'Use application/json')
    let input
    try { input = JSON.parse(await bodyText(request, 10000)) } catch (e) { if (e instanceof ConnectorError) throw e; throw new ConnectorError('invalid_client_metadata', 'Invalid JSON') }
    if (!input || !Array.isArray(input.redirect_uris) || input.redirect_uris.length < 1 || input.redirect_uris.length > 10 || !input.redirect_uris.every(validRedirect)) throw new ConnectorError('invalid_redirect_uri', 'Use an exact HTTPS callback URL without a fragment')
    const method = input.token_endpoint_auth_method || 'none'
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)
      || (input.grant_types && (!Array.isArray(input.grant_types) || input.grant_types.some((v: string) => !['authorization_code', 'refresh_token'].includes(v))))
      || (input.response_types && (input.response_types.length !== 1 || input.response_types[0] !== 'code'))) throw new ConnectorError('invalid_client_metadata', 'Unsupported authentication flow')
    const name = typeof input.client_name === 'string' ? input.client_name.trim().slice(0, 100) : 'AI-assistent'
    const clientId = token(), secret = method === 'none' ? null : token()
    const { error } = await createServiceRoleClient().from('connector_clients').insert({ id: clientId, name: name || 'AI-assistent',
      redirect_uris: [...new Set(input.redirect_uris)], auth_method: method, secret_hash: secret ? hash(secret) : null })
    if (error) throw new Error('Registration failed')
    return json({ client_id: clientId, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: method, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201)
  } catch (error) { return errorResponse(error) }
}
