'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession } from './auth'
import { revalidatePath } from 'next/cache'

export async function createList(name: string, storeId?: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({
      household_id: householdId,
      name,
      store_id: storeId || null,
    })
    .select()
    .single()

  if (error) return { error: 'Kunne ikkje opprette liste' }
  revalidatePath('/lister')
  return { list: data }
}

export async function deleteList(listId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('shopping_lists')
    .delete()
    .eq('id', listId)
    .eq('household_id', householdId)

  if (error) return { error: 'Kunne ikkje slette liste' }
  revalidatePath('/lister')
  return { success: true }
}

export async function updateList(listId: string, updates: { name?: string; store_id?: string | null; is_active?: boolean }) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('shopping_lists')
    .update(updates)
    .eq('id', listId)
    .eq('household_id', householdId)

  if (error) return { error: 'Kunne ikkje oppdatere liste' }
  revalidatePath('/lister')
  revalidatePath(`/lister/${listId}`)
  return { success: true }
}

export async function addItemToList(listId: string, itemId: string, quantity?: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()

  // Check item isn't already on the list
  const { data: existing } = await supabase
    .from('list_items')
    .select('id')
    .eq('list_id', listId)
    .eq('item_id', itemId)
    .single()

  if (existing) return { error: 'Vara er allereie på lista' }

  const { data, error } = await supabase
    .from('list_items')
    .insert({
      list_id: listId,
      item_id: itemId,
      quantity: quantity || '1',
    })
    .select()
    .single()

  if (error) return { error: 'Kunne ikkje legge til vare' }
  return { listItem: data }
}

export async function toggleListItem(listItemId: string, isChecked: boolean) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()

  const updates: Record<string, unknown> = {
    is_checked: isChecked,
    checked_at: isChecked ? new Date().toISOString() : null,
  }

  // Increment times_purchased when checking off
  if (isChecked) {
    const { data: listItem } = await supabase
      .from('list_items')
      .select('item_id')
      .eq('id', listItemId)
      .single()

    if (listItem) {
      const { data: item } = await supabase
        .from('items')
        .select('times_purchased')
        .eq('id', listItem.item_id)
        .single()

      if (item) {
        await supabase
          .from('items')
          .update({ times_purchased: (item.times_purchased || 0) + 1 })
          .eq('id', listItem.item_id)
      }
    }
  }

  const { error } = await supabase
    .from('list_items')
    .update(updates)
    .eq('id', listItemId)

  if (error) return { error: 'Kunne ikkje oppdatere vare' }
  return { success: true }
}

export async function removeListItem(listItemId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('list_items')
    .delete()
    .eq('id', listItemId)

  if (error) return { error: 'Kunne ikkje fjerne vare' }
  return { success: true }
}

export async function updateListItemQuantity(listItemId: string, quantity: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('list_items')
    .update({ quantity })
    .eq('id', listItemId)

  if (error) return { error: 'Kunne ikkje oppdatere mengde' }
  return { success: true }
}
