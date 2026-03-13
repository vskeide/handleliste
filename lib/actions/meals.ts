'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession } from './auth'
import { revalidatePath } from 'next/cache'

export async function getMeals() {
  const householdId = await getSession()
  if (!householdId) return []

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('meals')
    .select('*, meal_items(count)')
    .eq('household_id', householdId)
    .order('name')

  return data || []
}

export async function getMeal(mealId: string) {
  const householdId = await getSession()
  if (!householdId) return null

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('meals')
    .select('*, meal_items(*, items(name, section_id, sections(name_nn, icon, color)))')
    .eq('id', mealId)
    .eq('household_id', householdId)
    .single()

  return data
}

export async function createMeal(name: string, icon: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('meals')
    .insert({
      household_id: householdId,
      name: name.trim(),
      icon: icon || '🍽️',
    })
    .select()
    .single()

  if (error) return { error: 'Kunne ikkje opprette måltid' }
  revalidatePath('/middagar')
  return { meal: data }
}

export async function updateMeal(mealId: string, updates: { name?: string; icon?: string }) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  await supabase.from('meals').update(updates).eq('id', mealId).eq('household_id', householdId)
  revalidatePath('/middagar')
  return { success: true }
}

export async function deleteMeal(mealId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  await supabase.from('meal_items').delete().eq('meal_id', mealId)
  await supabase.from('meals').delete().eq('id', mealId).eq('household_id', householdId)
  revalidatePath('/middagar')
  return { success: true }
}

export async function addMealItem(mealId: string, itemId: string, quantity?: string) {
  const supabase = createServiceRoleClient()

  const { data: existing } = await supabase
    .from('meal_items')
    .select('id')
    .eq('meal_id', mealId)
    .eq('item_id', itemId)
    .single()

  if (existing) return { error: 'Vara er allereie i måltidet' }

  await supabase.from('meal_items').insert({
    meal_id: mealId,
    item_id: itemId,
    quantity: quantity || '1',
  })

  revalidatePath('/middagar')
  return { success: true }
}

export async function removeMealItem(mealItemId: string) {
  const supabase = createServiceRoleClient()
  await supabase.from('meal_items').delete().eq('id', mealItemId)
  revalidatePath('/middagar')
  return { success: true }
}

export async function addMealToList(mealId: string, listId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()

  // Get meal items
  const { data: meal } = await supabase
    .from('meals')
    .select('meal_items(item_id, quantity)')
    .eq('id', mealId)
    .single()

  if (!meal?.meal_items?.length) return { error: 'Måltidet har ingen varer' }

  // Get existing items on the list
  const { data: existing } = await supabase
    .from('list_items')
    .select('item_id')
    .eq('list_id', listId)

  const existingIds = new Set((existing || []).map((e: any) => e.item_id))

  // Add only items not already on the list
  const newItems = meal.meal_items
    .filter((mi: any) => !existingIds.has(mi.item_id))
    .map((mi: any) => ({
      list_id: listId,
      item_id: mi.item_id,
      quantity: mi.quantity,
    }))

  if (newItems.length > 0) {
    await supabase.from('list_items').insert(newItems)
  }

  return { added: newItems.length, skipped: meal.meal_items.length - newItems.length }
}

export async function updateMealItemQuantity(mealItemId: string, quantity: string) {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('meal_items')
    .update({ quantity })
    .eq('id', mealItemId)

  if (error) return { error: 'Kunne ikkje oppdatere mengde' }
  return { success: true }
}
