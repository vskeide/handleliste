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
  if (op.kind === 'mealServings' && (!Number.isFinite(op.servings) || op.servings < 0.5 || op.servings > 100)) return {error:'Vel mellom 0,5 og 100 porsjonar.'}
  const db = createServiceRoleClient()
  const { data, error } = await db.rpc('apply_list_operation', { p_household: household, p_list: listId, p_operation: write.id, p_payload: op })
  if (error) {
    const mealErrors: Record<string,string> = {
      MEAL_NOT_FOUND:'Retten eller ingrediensen er fjerna frå lista. Forkast denne endringa og hent lista på nytt.',
      MEAL_SERVINGS_REQUIRED:'Oppgi kor mange porsjonar mengdene er til før du skalerer.',
      MEAL_INVALID_QUANTITY:'Vel ei gyldig mengd større enn null.',
      MEAL_SOURCE_MANUAL:'Mengda er endra manuelt eller vara er fjerna. Endre denne vara i sjølve handlelista.',
      MEAL_QUANTITY_CONFLICT:'Mengdene kan ikkje kombinerast. Bruk same type eining som resten av vara på lista.',
    }
    if (error.code==='22023' && mealErrors[error.message]) return {error:mealErrors[error.message]}
    if (!error.code || /fetch|network|timeout/i.test(error.message)) throw new Error('Network unavailable')
    console.error('List write refused', error.code)
    return { error: 'Kunne ikkje lagre endringa. Prøv igjen, eller forkast venta endringar.' }
  }
  return data as WriteResult
}
