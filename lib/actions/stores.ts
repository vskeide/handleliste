'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession, getHousehold } from './auth'
import { revalidatePath } from 'next/cache'
import type { StoreMapBlock } from '@/lib/types'
import { STORE_CHAIN_LABELS } from '@/lib/constants'
import { randomUUID } from 'node:crypto'

export async function createStore(input: { name: string; chain: string; city: string; address?: string }) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }
  const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length <= max
    && !/[\u0000-\u001f]/.test(value) ? value.trim() : null
  const name = text(input?.name, 100), city = text(input?.city, 100)
  const address = text(input?.address ?? '', 200)
  if (!name || !city || address === null || typeof input?.chain !== 'string' || !Object.hasOwn(STORE_CHAIN_LABELS, input.chain)) {
    return { error: 'Fyll inn namn, kjede og stad. Kontroller at felta ikkje er for lange.' }
  }
  const db = createServiceRoleClient(), storeId = randomUUID()
  // Reserve map ownership at creation, before the first map has been saved.
  const { error } = await db.from('stores').insert({
    id: storeId, name, chain: input.chain, city, address: address || null,
    is_mapped: false, mapped_by_household_id: householdId,
  })
  if (error) return { error: 'Kunne ikkje opprette butikken. Prøv igjen.' }
  const { error: linkError } = await db.from('household_stores').insert({ household_id: householdId, store_id: storeId })
  if (linkError) {
    // Compensate only for the new row created by this request; existing shops are untouched.
    const { error: cleanupError } = await db.from('stores').delete().eq('id', storeId).eq('mapped_by_household_id', householdId)
    if (cleanupError) console.error('Could not clean up unlinked new store', cleanupError.code)
    return { error: 'Kunne ikkje leggje butikken til husstanden. Prøv igjen.' }
  }
  revalidatePath('/butikkar')
  return { storeId }
}

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
  if (!(await getSession())) return null
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

  if (!mapData || typeof mapData !== 'object') return { error: 'Ugyldig kart' }
  const { grid_cols, grid_rows, entrance_position, checkout_position, blocks } = mapData
  const sizeOk = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100
  const pointOk = (p: { col: number; row: number }) => p && Number.isInteger(p.col) && Number.isInteger(p.row)
    && p.col >= 0 && p.col < grid_cols && p.row >= 0 && p.row < grid_rows
  if (!sizeOk(grid_cols) || !sizeOk(grid_rows) || !pointOk(entrance_position) || !pointOk(checkout_position)
    || !Array.isArray(blocks) || blocks.length > 1000 || blocks.some((b) => !b || !pointOk(b)
      || !sizeOk(b.width) || !sizeOk(b.height) || b.col + b.width > grid_cols || b.row + b.height > grid_rows
      || typeof b.section_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.section_id))) {
    return { error: 'Ugyldig kart' }
  }
  // Only copy known fields. Nested objects from a server action are untrusted too.
  const safeMap = {
    grid_cols, grid_rows,
    entrance_position: { col: entrance_position.col, row: entrance_position.row },
    checkout_position: { col: checkout_position.col, row: checkout_position.row },
    blocks: blocks.map(({ section_id, col, row, width, height }) => ({ section_id, col, row, width, height })),
  }

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

  const { error: saveError } = await supabase.from('store_maps').upsert({
    ...safeMap,
    store_id: storeId,
    updated_by_household_id: householdId,
  }, { onConflict: 'store_id' })
  if (saveError) return { error: 'Kunne ikkje lagre kartet' }

  // Mark store as mapped if not already
  if (!store.is_mapped) {
    const { error } = await supabase
      .from('stores')
      .update({
        is_mapped: true,
        mapped_by_household_id: store.mapped_by_household_id || householdId,
      })
      .eq('id', storeId)
    if (error) return { error: 'Kartet er lagra, men butikken kunne ikkje oppdaterast' }
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
