'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession } from './auth'

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
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'Vara finst allereie' }
    return { error: 'Kunne ikkje opprette vare' }
  }
  return { item: data }
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
