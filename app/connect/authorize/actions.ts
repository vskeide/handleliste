'use server'
import { redirect } from 'next/navigation'
import { readSession } from '@/lib/session'
import { joinHousehold } from '@/lib/actions/auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateAuthorization } from '@/lib/connector/auth'
import { hash, origin, token } from '@/lib/connector/security'

export async function connectorLogin(form: FormData) {
  const params = new URLSearchParams(String(form.get('request') || ''))
  await validateAuthorization(params)
  const result = await joinHousehold(String(form.get('code') || ''), String(form.get('pin') || ''))
  if (result.error) params.set('notice', result.error)
  redirect(`/connect/authorize?${params}`)
}
export async function connectorConsent(form: FormData) {
  const { request } = await validateAuthorization(new URLSearchParams(String(form.get('request') || '')))
  const household = await readSession()
  if (!household) redirect(`/connect/authorize?${new URLSearchParams(request as unknown as Record<string, string>)}`)
  const callback = new URL(request.redirect_uri)
  callback.searchParams.set('iss', origin())
  if (request.state) callback.searchParams.set('state', request.state)
  if (form.get('decision') !== 'approve') callback.searchParams.set('error', 'access_denied')
  else {
    const code = token()
    const { error } = await createServiceRoleClient().from('connector_codes').insert({ code_hash: hash(code),
      client_id: request.client_id, household_id: household, redirect_uri: request.redirect_uri,
      challenge: request.code_challenge, resource: request.resource, scope: request.scope })
    if (error) throw new Error('Kunne ikkje kople til. Prøv igjen.')
    callback.searchParams.set('code', code)
  }
  redirect(callback.toString())
}
