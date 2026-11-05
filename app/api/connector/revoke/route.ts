import { createServiceRoleClient } from '@/lib/supabase/server'
import { authenticateClient, rateLimit } from '@/lib/connector/auth'
import { bodyText, errorResponse, hash } from '@/lib/connector/security'
export async function POST(request: Request) {
  try {
    await rateLimit(`revoke:${request.headers.get('x-forwarded-for') || 'unknown'}`, 100, 3600)
    const params = new URLSearchParams(await bodyText(request, 12000)), client = await authenticateClient(request, params)
    const value = params.get('token') || ''
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
      const { error } = await createServiceRoleClient().from('connector_connections').update({ revoked_at: new Date().toISOString() })
        .eq('client_id', client.id).or(`access_hash.eq.${hash(value)},refresh_hash.eq.${hash(value)}`)
      if (error) throw new Error('Revocation failed')
    }
    return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
