import type { createServiceRoleClient } from '@/lib/supabase/server'

// Server actions use the service-role client, which bypasses Row Level Security.
// Every action that receives a row id from the browser must therefore check that
// the row belongs to the logged-in household before touching it.

type DB = ReturnType<typeof createServiceRoleClient>

export async function ownsList(db: DB, householdId: string, listId: string) {
  const { data } = await db
    .from('shopping_lists')
    .select('id')
    .eq('id', listId)
    .eq('household_id', householdId)
    .maybeSingle()
  return !!data
}

/** The list line if its list belongs to the household, else null. */
export async function ownedListItem(db: DB, householdId: string, listItemId: string) {
  const { data } = await db
    .from('list_items')
    .select('id, list_id, item_id')
    .eq('id', listItemId)
    .maybeSingle()
  if (!data) return null
  return (await ownsList(db, householdId, data.list_id)) ? data : null
}

export async function ownsItem(db: DB, householdId: string, itemId: string) {
  const { data } = await db
    .from('items')
    .select('id')
    .eq('id', itemId)
    .eq('household_id', householdId)
    .maybeSingle()
  return !!data
}

export async function ownsMeal(db: DB, householdId: string, mealId: string) {
  const { data } = await db
    .from('meals')
    .select('id')
    .eq('id', mealId)
    .eq('household_id', householdId)
    .maybeSingle()
  return !!data
}

/** The meal line if its meal belongs to the household, else null. */
export async function ownedMealItem(db: DB, householdId: string, mealItemId: string) {
  const { data } = await db
    .from('meal_items')
    .select('id, meal_id')
    .eq('id', mealItemId)
    .maybeSingle()
  if (!data) return null
  return (await ownsMeal(db, householdId, data.meal_id)) ? data : null
}

export async function ownsTemplate(db: DB, householdId: string, templateId: string) {
  const { data } = await db
    .from('list_templates')
    .select('id')
    .eq('id', templateId)
    .eq('household_id', householdId)
    .maybeSingle()
  return !!data
}
