'use server'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { UUID } from '@/lib/connector/security'

export async function revokeConnection(form: FormData) {
  const household = await requireSession(), id = String(form.get('connection_id') || '')
  if (!UUID.test(id)) throw new Error('Ugyldig tilkopling')
  const { error } = await createServiceRoleClient().from('connector_connections').update({ revoked_at: new Date().toISOString() })
    .eq('household_id', household).eq('id', id)
  if (error) throw new Error('Kunne ikkje fjerne tilgangen. Prøv igjen.')
  revalidatePath('/innstillingar/assistentar')
}
