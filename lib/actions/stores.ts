'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession, getHousehold } from './auth'
import { revalidatePath } from 'next/cache'
import type { StoreMapBlock } from '@/lib/types'

export async function getHouseholdStores() {
  const householdId = await getSession()
  if (!householdId) return []

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('household_stores')
    .select('*, stores(*)')
    .eq('household_id', householdId)
    .order('is_favorite', { ascending: false })

  return data || []
}

export async function getWalkOrder(storeId: string) {
  const householdId = await getSession()
  if (!householdId) return []

  const supabase = createServiceRoleClient()

  // 1. Household custom override
  const { data: custom } = await supabase
    .from('household_store_layouts')
    .select('section_id, walk_order')
    .eq('household_id', householdId)
    .eq('store_id', storeId)
    .order('walk_order')

  if (custom && custom.length > 0) return custom

  // 2. Shared default
  const { data: shared } = await supabase
    .from('default_store_layouts')
    .select('section_id, walk_order')
    .eq('store_id', storeId)
    .order('walk_order')

  if (shared && shared.length > 0) return shared

  // 3. Section default order
  const { data: sections } = await supabase
    .from('sections')
    .select('id, default_sort_order')
    .order('default_sort_order')

  return (sections || []).map((s: { id: string; default_sort_order: number }) => ({
    section_id: s.id,
    walk_order: s.default_sort_order,
  }))
}

export async function saveWalkOrder(storeId: string, orders: { section_id: string; walk_order: number }[]) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const household = await getHousehold()
  if (!household) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()

  const { data: store } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single()

  if (!store) return { error: 'Fann ikkje butikk' }

  const canEditShared = household.is_admin || store.mapped_by_household_id === householdId

  if (canEditShared) {
    // Save to default_store_layouts (shared)
    await supabase
      .from('default_store_layouts')
      .delete()
      .eq('store_id', storeId)

    await supabase
      .from('default_store_layouts')
      .insert(
        orders.map((o) => ({
          store_id: storeId,
          section_id: o.section_id,
          walk_order: o.walk_order,
          created_by_household_id: householdId,
        }))
      )
  } else {
    // Save to household_store_layouts (personal)
    await supabase
      .from('household_store_layouts')
      .delete()
      .eq('household_id', householdId)
      .eq('store_id', storeId)

    await supabase
      .from('household_store_layouts')
      .insert(
        orders.map((o) => ({
          household_id: householdId,
          store_id: storeId,
          section_id: o.section_id,
          walk_order: o.walk_order,
        }))
      )
  }

  revalidatePath(`/butikkar/${storeId}`)
  return { success: true, isShared: canEditShared }
}

export async function getStoreMap(storeId: string) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('store_maps')
    .select('*')
    .eq('store_id', storeId)
    .single()

  return data
}

export async function saveStoreMap(
  storeId: string,
  mapData: {
    grid_cols: number
    grid_rows: number
    entrance_position: { col: number; row: number }
    checkout_position: { col: number; row: number }
    blocks: StoreMapBlock[]
  }
) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const household = await getHousehold()
  if (!household) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()

  const { data: store } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single()

  if (!store) return { error: 'Fann ikkje butikk' }

  const canEdit = household.is_admin || store.mapped_by_household_id === householdId
  if (!canEdit) return { error: 'Ingen tilgang' }

  const { data: existing } = await supabase
    .from('store_maps')
    .select('id')
    .eq('store_id', storeId)
    .single()

  if (existing) {
    await supabase
      .from('store_maps')
      .update({
        ...mapData,
        updated_by_household_id: householdId,
      })
      .eq('store_id', storeId)
  } else {
    await supabase
      .from('store_maps')
      .insert({
        store_id: storeId,
        ...mapData,
        updated_by_household_id: householdId,
      })
  }

  // Mark store as mapped if not already
  if (!store.is_mapped) {
    await supabase
      .from('stores')
      .update({
        is_mapped: true,
        mapped_by_household_id: store.mapped_by_household_id || householdId,
      })
      .eq('id', storeId)
  }

  revalidatePath(`/butikkar/${storeId}/kart`)
  return { success: true }
}

export async function canEditSharedMap(storeId: string) {
  const householdId = await getSession()
  if (!householdId) return false

  const household = await getHousehold()
  if (!household) return false
  if (household.is_admin) return true

  const supabase = createServiceRoleClient()
  const { data: store } = await supabase
    .from('stores')
    .select('mapped_by_household_id')
    .eq('id', storeId)
    .single()

  return store?.mapped_by_household_id === householdId
}
