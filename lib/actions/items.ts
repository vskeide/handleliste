'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession } from './auth'
import { ownsList } from '@/lib/ownership'

export async function searchItems(query: string) {
  const householdId = await getSession()
  if (!householdId) return []

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('items')
    .select('*, sections(name_nn, icon, color)')
    .eq('household_id', householdId)
    .ilike('name', `%${query}%`)
    .order('times_purchased', { ascending: false })
    .limit(20)

  return data || []
}

export async function createItem(name: string, sectionId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('items')
    .insert({
      household_id: householdId,
      name: name.trim(),
      section_id: sectionId,
      is_confirmed: false,
    })
    .select('*, sections(name_nn, icon, color)')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'Vara finst allereie' }
    return { error: 'Kunne ikkje opprette vare' }
  }
  return { item: data }
}

/**
 * Create a new household item and put it on a list in one call. The phone supplies both
 * ids so it can show the line before the server answers.
 */
export async function createItemAndAddToList(
  listId: string,
  name: string,
  sectionId: string,
  itemId: string,
  listItemId: string,
  quantity = '1',
  confirmed = false, // true when it comes from the product catalogue (no "Ny" badge)
) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(itemId) || !UUID_RE.test(listItemId)) return { error: 'Ugyldig id' }

  const supabase = createServiceRoleClient()
  if (!(await ownsList(supabase, householdId, listId))) return { error: 'Ingen tilgang' }

  const { data: item, error } = await supabase
    .from('items')
    .insert({ id: itemId, household_id: householdId, name: name.trim(), section_id: sectionId, is_confirmed: !!confirmed })
    .select('*, sections(name_nn, icon, color)')
    .single()
  if (error || !item) {
    if (error?.code === '23505') return { error: 'Vara finst allereie' }
    return { error: 'Kunne ikkje opprette vare' }
  }

  const { data: listItem, error: liErr } = await supabase
    .from('list_items')
    .insert({ id: listItemId, list_id: listId, item_id: item.id, quantity: quantity || '1' })
    .select()
    .single()
  if (liErr) return { error: 'Kunne ikkje legge til vare', item }
  return { item, listItem }
}

export async function updateItemSection(itemId: string, sectionId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('items')
    .update({ section_id: sectionId })
    .eq('id', itemId)
    .eq('household_id', householdId)

  if (error) return { error: 'Kunne ikkje flytte vara' }
  return { success: true }
}

export async function getHouseholdItems() {
  const householdId = await getSession()
  if (!householdId) return []

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('items')
    .select('*, sections(name_nn, icon, color)')
    .eq('household_id', householdId)
    .order('name')

  return data || []
}
