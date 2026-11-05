'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession } from './auth'
import { revalidatePath } from 'next/cache'
import { ownsMeal, ownedMealItem, ownsItem, ownsList } from '@/lib/ownership'
import { mergeIntoList, describeMerge } from '@/lib/list-merge'
import { scaleQty, addQty } from '@/lib/quantity'
import { parseEntry, splitEntries } from '@/lib/parse-list'
import { resolveName, guessSection, displayName, type KnownItem } from '@/lib/match'
import { STARTER_MEALS } from '@/lib/starter-meals'
import { randomUUID } from 'node:crypto'
import { portions, describeHousehold } from '@/lib/portions'

const NO_ACCESS = { error: 'Ingen tilgang' }

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
  if (!(await ownsMeal(supabase, householdId, mealId))) return NO_ACCESS
  await supabase.from('meal_items').delete().eq('meal_id', mealId)
  await supabase.from('meals').delete().eq('id', mealId).eq('household_id', householdId)
  revalidatePath('/middagar')
  return { success: true }
}

export async function addMealItem(mealId: string, itemId: string, quantity?: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  if (!(await ownsMeal(supabase, householdId, mealId)) || !(await ownsItem(supabase, householdId, itemId))) {
    return NO_ACCESS
  }

  const { data: existing } = await supabase
    .from('meal_items')
    .select('id')
    .eq('meal_id', mealId)
    .eq('item_id', itemId)
    .single()

  if (existing) return { error: 'Vara er allereie i måltidet' }

  const { error } = await supabase.from('meal_items').insert({
    meal_id: mealId,
    item_id: itemId,
    quantity: quantity || '1',
  })
  if (error) return { error: 'Kunne ikkje leggje til ingrediensen' }

  revalidatePath('/middagar')
  return { success: true }
}

export async function removeMealItem(mealItemId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  if (!(await ownedMealItem(supabase, householdId, mealItemId))) return NO_ACCESS
  await supabase.from('meal_items').delete().eq('id', mealItemId)
  revalidatePath('/middagar')
  return { success: true }
}

/**
 * Put a meal's ingredients on a list. If the meal says how many people it is for
 * (`servings`, migration 0003), amounts are scaled to `people` (default: household
 * size). Ingredients already on the list get their quantity added, not a second line.
 */
export async function addMealToList(mealId: string, listId: string, people?: number) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const [listOk, mealRes, hhRes] = await Promise.all([
    ownsList(supabase, householdId, listId),
    // select('*') so this works before and after the servings column exists
    supabase.from('meals').select('*, meal_items(item_id, quantity)').eq('id', mealId).eq('household_id', householdId).maybeSingle(),
    // select('*') so this works before and after migration 0004 (adults/children)
    supabase.from('households').select('*').eq('id', householdId).maybeSingle(),
  ])
  if (!listOk) return NO_ACCESS
  const meal = mealRes.data as any
  if (!meal?.meal_items?.length) return { error: 'Middagen har ingen varer' }

  const household = portions(hhRes.data as any)
  const target = people ?? household
  // A meal without "for N" is taken to be written for the household itself, so an
  // override of the portions still scales it
  const base = meal.servings ?? (people ? household : null)
  const factor = base && target ? target / base : 1
  const lines = meal.meal_items.map((mi: any) => ({ item_id: mi.item_id, quantity: scaleQty(mi.quantity, factor) }))

  const result = await mergeIntoList(supabase, listId, lines)
  return {
    ...result,
    summary: describeMerge(result),
    scaledFor: factor !== 1 ? (people ? `${String(people).replace('.', ',')} porsjonar` : describeHousehold(hhRes.data as any)) : null,
  }
}

/**
 * Turn pasted text ("400 g kjøtdeig\n1 boks hakka tomat\n…") into a meal's ingredients.
 * Each line is matched to a household item, a catalogue product (created as an item)
 * or a new item with a guessed section. Ingredients already in the meal get the
 * quantity added.
 */
export async function addRecipeTextToMeal(mealId: string, text: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }
  if (!text.trim()) return { error: 'Ingen tekst' }
  if (text.length > 5000) return { error: 'For lang tekst' }

  const supabase = createServiceRoleClient()
  if (!(await ownsMeal(supabase, householdId, mealId))) return NO_ACCESS

  const [itemsRes, sectionsRes, existingRes] = await Promise.all([
    supabase.from('items').select('id, name, section_id, times_purchased').eq('household_id', householdId),
    supabase.from('sections').select('id, name_nn'),
    supabase.from('meal_items').select('id, item_id, quantity').eq('meal_id', mealId),
  ])
  const known = (itemsRes.data || []) as KnownItem[]
  const sectionId = Object.fromEntries((sectionsRes.data || []).map((s: any) => [s.name_nn, s.id]))
  const fallback = sectionId['Tørrvarer'] ?? sectionsRes.data?.[0]?.id

  const wanted = new Map<string, string>() // item id → quantity
  const toCreate: { id: string; household_id: string; name: string; section_id: string; is_confirmed: boolean }[] = []
  const unknown: string[] = []

  for (const entry of splitEntries(text)) {
    const { name, quantity } = parseEntry(entry)
    if (!name || name.length > 80) continue
    const hit = resolveName([...known, ...toCreate.map((c) => ({ id: c.id, name: c.name, section_id: c.section_id }))], name)
    let itemId: string
    if (hit?.kind === 'item') {
      itemId = hit.item.id
    } else {
      itemId = randomUUID()
      const product = hit?.kind === 'catalog' ? hit.product : null
      const guessed = product ? product.section : guessSection(name)
      toCreate.push({
        id: itemId,
        household_id: householdId,
        name: product?.name ?? displayName(name),
        section_id: (guessed && sectionId[guessed]) || fallback,
        is_confirmed: !!product,
      })
      if (!product) unknown.push(displayName(name))
    }
    const prev = wanted.get(itemId)
    wanted.set(itemId, prev ? addQty(prev, quantity) ?? prev : quantity)
  }

  if (toCreate.length) {
    const { error } = await supabase.from('items').insert(toCreate)
    if (error) return { error: 'Kunne ikkje opprette nye varer' }
  }

  const existing = new Map((existingRes.data || []).map((e: any) => [e.item_id, e]))
  const inserts: { meal_id: string; item_id: string; quantity: string }[] = []
  const updates: PromiseLike<unknown>[] = []
  wanted.forEach((qty, itemId) => {
    const e = existing.get(itemId)
    if (!e) inserts.push({ meal_id: mealId, item_id: itemId, quantity: qty })
    else {
      const sum = addQty(e.quantity, qty)
      if (sum) updates.push(supabase.from('meal_items').update({ quantity: sum }).eq('id', e.id))
    }
  })
  if (inserts.length) await supabase.from('meal_items').insert(inserts)
  await Promise.all(updates)

  revalidatePath('/middagar')
  return { added: inserts.length, updated: updates.length, created: toCreate.length, unknown }
}

/** Save a starter dinner (lib/starter-meals.ts) as one of the household's own meals. */
export async function saveStarterMeal(name: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }
  const starter = STARTER_MEALS.find((m) => m.name === name)
  if (!starter) return { error: 'Fann ikkje middagen' }

  const supabase = createServiceRoleClient()
  const { data: same } = await supabase.from('meals').select('id').eq('household_id', householdId).ilike('name', starter.name).maybeSingle()
  if (same) return { meal: same, existed: true }

  // servings needs migration 0003; without it the meal is saved unscaled
  let meal: any = null
  const withServings = await supabase.from('meals').insert({ household_id: householdId, name: starter.name, icon: starter.icon, servings: starter.servings }).select().single()
  if (withServings.error) {
    const plain = await supabase.from('meals').insert({ household_id: householdId, name: starter.name, icon: starter.icon }).select().single()
    if (plain.error) return { error: 'Kunne ikkje lagre middagen' }
    meal = plain.data
  } else meal = withServings.data

  const text = starter.ingredients.map((i) => `${i.qty} ${i.name}`).join('\n')
  // Reuse the recipe matcher so ingredients map to the household's own items
  const r: any = await addRecipeTextToMeal(meal.id, text)
  if (r?.error) return r
  revalidatePath('/middagar')
  return { meal, servingsSaved: !withServings.error }
}

export async function setMealServings(mealId: string, servings: number | null) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }
  if (servings !== null && (!Number.isInteger(servings) || servings < 1 || servings > 20)) {
    return { error: 'Tal personar må vere 1–20' }
  }
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from('meals').update({ servings }).eq('id', mealId).eq('household_id', householdId)
  if (error) {
    // Most likely migration 0003 has not been run yet
    return { error: 'Kunne ikkje lagre tal personar (manglar databaseendring 0003?)' }
  }
  revalidatePath('/middagar')
  return { success: true }
}

export async function updateMealItemQuantity(mealItemId: string, quantity: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  if (!(await ownedMealItem(supabase, householdId, mealItemId))) return NO_ACCESS
  const { error } = await supabase
    .from('meal_items')
    .update({ quantity })
    .eq('id', mealItemId)

  if (error) return { error: 'Kunne ikkje oppdatere mengde' }
  return { success: true }
}
