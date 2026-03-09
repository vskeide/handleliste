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

  // Increment times_purchased and track check order when checking off
  if (isChecked) {
    const { data: listItem } = await supabase
      .from('list_items')
      .select('item_id, list_id')
      .eq('id', listItemId)
      .single()

    if (listItem) {
      // Count how many items are already checked in this list (= position)
      const { count } = await supabase
        .from('list_items')
        .select('*', { count: 'exact', head: true })
        .eq('list_id', listItem.list_id)
        .eq('is_checked', true)

      const checkPosition = (count || 0) + 1

      const { data: item } = await supabase
        .from('items')
        .select('times_purchased, check_order_sum, check_count')
        .eq('id', listItem.item_id)
        .single()

      if (item) {
        await supabase
          .from('items')
          .update({
            times_purchased: (item.times_purchased || 0) + 1,
            check_order_sum: (item.check_order_sum || 0) + checkPosition,
            check_count: (item.check_count || 0) + 1,
          })
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

export async function uncheckAllItems(listId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('list_items')
    .update({ is_checked: false, checked_at: null })
    .eq('list_id', listId)
    .eq('is_checked', true)

  if (error) return { error: 'Kunne ikkje nullstille lista' }
  return { success: true }
}

export async function saveAsTemplate(listId: string, templateName: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()

  // Get current list items
  const { data: listItems } = await supabase
    .from('list_items')
    .select('item_id, quantity')
    .eq('list_id', listId)

  if (!listItems || listItems.length === 0) return { error: 'Lista er tom' }

  // Get the list's store
  const { data: list } = await supabase
    .from('shopping_lists')
    .select('store_id')
    .eq('id', listId)
    .single()

  // Create template
  const { data: template, error: tErr } = await supabase
    .from('list_templates')
    .insert({
      household_id: householdId,
      name: templateName,
      store_id: list?.store_id || null,
    })
    .select()
    .single()

  if (tErr || !template) return { error: 'Kunne ikkje opprette mal' }

  // Copy items to template
  const templateItems = listItems.map((li) => ({
    template_id: template.id,
    item_id: li.item_id,
    quantity: li.quantity,
  }))

  await supabase.from('template_items').insert(templateItems)

  revalidatePath('/lister')
  return { template }
}

export async function getTemplates() {
  const householdId = await getSession()
  if (!householdId) return []

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('list_templates')
    .select('*, template_items(count), stores(name, chain)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })

  return data || []
}

export async function createListFromTemplate(templateId: string, listName: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()

  // Get template with items
  const { data: template } = await supabase
    .from('list_templates')
    .select('*, template_items(item_id, quantity)')
    .eq('id', templateId)
    .single()

  if (!template) return { error: 'Mal ikkje funnen' }

  // Create new list
  const { data: list, error: lErr } = await supabase
    .from('shopping_lists')
    .insert({
      household_id: householdId,
      name: listName,
      store_id: template.store_id,
    })
    .select()
    .single()

  if (lErr || !list) return { error: 'Kunne ikkje opprette liste' }

  // Add template items to list
  if (template.template_items?.length > 0) {
    const items = template.template_items.map((ti: any) => ({
      list_id: list.id,
      item_id: ti.item_id,
      quantity: ti.quantity,
    }))
    await supabase.from('list_items').insert(items)
  }

  revalidatePath('/lister')
  return { list }
}

export async function deleteTemplate(templateId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  await supabase.from('template_items').delete().eq('template_id', templateId)
  await supabase.from('list_templates').delete().eq('id', templateId).eq('household_id', householdId)

  revalidatePath('/lister')
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
