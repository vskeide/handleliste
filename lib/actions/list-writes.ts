'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession } from './auth'
import type { PendingWrite, WriteResult } from '@/lib/list-outbox'

export async function applyListWrite(listId: string, write: PendingWrite): Promise<WriteResult> {
  const household = await getSession()
  if (!household) return { error: 'Ikkje innlogga. Logg inn att før du sender endringane.' }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!write || !uuid.test(write.id) || !uuid.test(listId) || !write.op || JSON.stringify(write.op).length > 100000) return { error: 'Ugyldig endring' }
  const op = write.op
  if (op.kind === 'toggle' && typeof op.checked !== 'boolean') return { error: 'Ugyldig endring' }
  const db = createServiceRoleClient()
  const { data, error } = await db.rpc('apply_list_operation', { p_household: household, p_list: listId, p_operation: write.id, p_payload: op })
  if (error) {
    if (!error.code || /fetch|network|timeout/i.test(error.message)) throw new Error('Network unavailable')
    console.error('List write refused', error.code)
    return { error: 'Kunne ikkje lagre endringa. Prøv igjen, eller forkast venta endringar.' }
  }
  return data as WriteResult
}
