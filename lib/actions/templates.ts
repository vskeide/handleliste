'use server'

import { revalidatePath } from 'next/cache'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession } from './auth'
import { ownsItem, ownsTemplate } from '@/lib/ownership'

// Editing a template ("mal") in place. Using one to start a list is
// createListFromTemplate in lists.ts.

const NO_ACCESS = { error: 'Ingen tilgang' }
const NOT_LOGGED_IN = { error: 'Ikkje innlogga' }

export async function renameTemplate(templateId: string, name: string) {
  const householdId = await getSession()
  if (!householdId) return NOT_LOGGED_IN
  if (!name.trim()) return { error: 'Namn er påkrevd' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('list_templates')
    .update({ name: name.trim() })
    .eq('id', templateId)
    .eq('household_id', householdId)
  if (error) return { error: 'Kunne ikkje endre namn' }
  revalidatePath('/lister')
  return { success: true }
}

export async function setTemplateStore(templateId: string, storeId: string | null) {
  const householdId = await getSession()
  if (!householdId) return NOT_LOGGED_IN

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('list_templates')
    .update({ store_id: storeId })
    .eq('id', templateId)
    .eq('household_id', householdId)
  if (error) return { error: 'Kunne ikkje endre butikk' }
  revalidatePath('/lister')
  return { success: true }
}

export async function addTemplateItem(templateId: string, itemId: string, quantity = '1') {
  const householdId = await getSession()
  if (!householdId) return NOT_LOGGED_IN

  const supabase = createServiceRoleClient()
  const [tOk, iOk, existing] = await Promise.all([
    ownsTemplate(supabase, householdId, templateId),
    ownsItem(supabase, householdId, itemId),
    supabase.from('template_items').select('*').eq('template_id', templateId).eq('item_id', itemId).maybeSingle(),
  ])
  if (!tOk || !iOk) return NO_ACCESS
  if (existing.data) return { templateItem: existing.data, existed: true }

  const { data, error } = await supabase
    .from('template_items')
    .insert({ template_id: templateId, item_id: itemId, quantity })
    .select()
    .single()
  if (error) return { error: 'Kunne ikkje legge til vare' }
  revalidatePath('/lister')
  return { templateItem: data }
}

async function ownedTemplateItem(supabase: ReturnType<typeof createServiceRoleClient>, householdId: string, id: string) {
  const { data } = await supabase.from('template_items').select('id, template_id').eq('id', id).maybeSingle()
  if (!data) return null
  return (await ownsTemplate(supabase, householdId, data.template_id)) ? data : null
}

export async function removeTemplateItem(templateItemId: string) {
  const householdId = await getSession()
  if (!householdId) return NOT_LOGGED_IN

  const supabase = createServiceRoleClient()
  if (!(await ownedTemplateItem(supabase, householdId, templateItemId))) return NO_ACCESS
  const { error } = await supabase.from('template_items').delete().eq('id', templateItemId)
  if (error) return { error: 'Kunne ikkje fjerne vare' }
  revalidatePath('/lister')
  return { success: true }
}

export async function updateTemplateItemQuantity(templateItemId: string, quantity: string) {
  const householdId = await getSession()
  if (!householdId) return NOT_LOGGED_IN

  const supabase = createServiceRoleClient()
  if (!(await ownedTemplateItem(supabase, householdId, templateItemId))) return NO_ACCESS
  const { error } = await supabase.from('template_items').update({ quantity }).eq('id', templateItemId)
  if (error) return { error: 'Kunne ikkje oppdatere mengde' }
  return { success: true }
}
