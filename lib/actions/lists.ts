'use server'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getSession } from './auth'
import { revalidatePath } from 'next/cache'
import { ownsList, ownedListItem, ownsItem, ownsTemplate } from '@/lib/ownership'
import { mergeIntoList, describeMerge } from '@/lib/list-merge'

const NO_ACCESS = { error: 'Ingen tilgang' }

// Moving average over about the last 8 trips: early trips count fully, later ones
// shift the average by 1/8, so a rearranged shop is relearnt within a few visits.
const ROUTE_MEMORY = 8

async function learnRoute(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: 'item_store_routes' | 'section_store_routes',
  key: Record<string, string>,
  pos: number,
) {
  let q = supabase.from(table).select('avg_pos, n')
  for (const [k, v] of Object.entries(key)) q = q.eq(k, v)
  const { data, error } = await q.maybeSingle()
  if (error) return // table missing (migration 0005 not run): skip quietly
  const n = (data?.n ?? 0) + 1
  const avg = data ? data.avg_pos + (pos - data.avg_pos) / Math.min(n, ROUTE_MEMORY) : pos
  await supabase.from(table).upsert({ ...key, avg_pos: avg, n, updated_at: new Date().toISOString() })
}

/**
 * Add many lines at once (typed "mjølk, 2 kg potet, 3 egg", a pasted recipe, a starter
 * dinner). The phone has already matched each entry to an existing item or decided to
 * create one; new items are created here, then everything is merged into the list.
 */
export async function addLinesToList(
  listId: string,
  lines: { itemId: string; quantity: string; create?: { name: string; sectionId: string } }[],
) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }
  if (!Array.isArray(lines) || lines.length === 0) return { error: 'Ingenting å legge til' }
  if (lines.length > 100) return { error: 'For mange varer på ein gong' }
  if (lines.some((l) => !UUID_RE.test(l.itemId))) return { error: 'Ugyldig id' }

  const supabase = createServiceRoleClient()
  if (!(await ownsList(supabase, householdId, listId))) return NO_ACCESS

  // Create the new items first (ids chosen by the phone so it can show them already)
  const toCreate = lines.filter((l) => l.create && l.create.name.trim())
  if (toCreate.length) {
    const { error } = await supabase.from('items').insert(
      toCreate.map((l) => ({
        id: l.itemId,
        household_id: householdId,
        name: l.create!.name.trim(),
        section_id: l.create!.sectionId,
        is_confirmed: false,
      })),
    )
    if (error) return { error: 'Kunne ikkje opprette nye varer. Sjekk om vara finst frå før.' }
  }

  // Every item must belong to this household (also catches made-up ids)
  const ids = Array.from(new Set(lines.map((l) => l.itemId)))
  const { data: owned } = await supabase.from('items').select('id').eq('household_id', householdId).in('id', ids)
  const ownedIds = new Set((owned || []).map((o: any) => o.id))
  if (ids.some((id) => !ownedIds.has(id))) return NO_ACCESS
  const valid = lines.filter((l) => ownedIds.has(l.itemId)).map((l) => ({ item_id: l.itemId, quantity: l.quantity || '1' }))

  const result = await mergeIntoList(supabase, listId, valid)
  if ('error' in result) return result
  return { ...result, summary: describeMerge(result), created: toCreate.length }
}

/** Copy the lines of the household's previous list into this one ("Same as last time"). */
export async function copyFromPreviousList(listId: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  if (!(await ownsList(supabase, householdId, listId))) return NO_ACCESS

  const { data: lists } = await supabase
    .from('shopping_lists')
    .select('id, name')
    .eq('household_id', householdId)
    .neq('id', listId)
  if (!lists?.length) return { error: 'Fann inga tidlegare liste' }

  // "Previous" = the other list with the most recent activity
  const { data: last } = await supabase
    .from('list_items')
    .select('list_id')
    .in('list_id', lists.map((l) => l.id))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!last) return { error: 'Tidlegare lister er tomme' }

  const { data: lines } = await supabase.from('list_items').select('item_id, quantity').eq('list_id', last.list_id)
  const result = await mergeIntoList(supabase, listId, lines || [])
  if ('error' in result) return result
  const from = lists.find((l) => l.id === last.list_id)?.name ?? 'førre liste'
  return { ...result, summary: describeMerge(result), from }
}

/** List lines for one list. Replaces the browser's direct table read (blocked by RLS). */
export async function getListItems(listId: string) {
  const householdId = await getSession()
  if (!householdId) return null

  const supabase = createServiceRoleClient()
  if (!(await ownsList(supabase, householdId, listId))) return null

  const { data, error } = await supabase
    .from('list_items')
    .select('*')
    .eq('list_id', listId)
    .order('created_at')
  // A failed refresh must not replace a real list with an empty one.
  return error ? null : data || []
}

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
  if (!(await ownsList(supabase, householdId, listId))) return NO_ACCESS
  // Lines first, in case the foreign key doesn't cascade
  await supabase.from('list_items').delete().eq('list_id', listId)
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

  // Server-action arguments are untrusted at runtime, regardless of TS types.
  const safe: { name?: string; store_id?: string | null; is_active?: boolean } = {}
  if (!updates || typeof updates !== 'object') return { error: 'Ugyldig endring' }
  if ('name' in updates) {
    if (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.length > 100) return { error: 'Ugyldig namn' }
    safe.name = updates.name.trim()
  }
  if ('store_id' in updates) {
    if (updates.store_id !== null && (typeof updates.store_id !== 'string' || !UUID_RE.test(updates.store_id))) return { error: 'Ugyldig butikk' }
    safe.store_id = updates.store_id
  }
  if ('is_active' in updates) {
    if (typeof updates.is_active !== 'boolean') return { error: 'Ugyldig endring' }
    safe.is_active = updates.is_active
  }
  if (!Object.keys(safe).length) return { error: 'Inga endring' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('shopping_lists')
    .update(safe)
    .eq('id', listId)
    .eq('household_id', householdId)

  if (error) return { error: 'Kunne ikkje oppdatere liste' }
  revalidatePath('/lister')
  revalidatePath(`/lister/${listId}`)
  return { success: true }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Add an item to a list. `clientId` lets the phone pick the row id up front, so it can
 * show the line instantly and match it with the server row afterwards.
 */
export async function addItemToList(listId: string, itemId: string, quantity?: string, clientId?: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  // Ownership and duplicate checks run in parallel (all server-side, same region as the DB)
  const [listOk, itemOk, existingRes] = await Promise.all([
    ownsList(supabase, householdId, listId),
    ownsItem(supabase, householdId, itemId),
    supabase.from('list_items').select('*').eq('list_id', listId).eq('item_id', itemId).maybeSingle(),
  ])
  if (!listOk || !itemOk) return NO_ACCESS

  // Already on the list: return the existing line instead of failing
  if (existingRes.data) return { listItem: existingRes.data, existed: true }

  const { data, error } = await supabase
    .from('list_items')
    .insert({
      ...(clientId && UUID_RE.test(clientId) ? { id: clientId } : {}),
      list_id: listId,
      item_id: itemId,
      quantity: quantity || '1',
    })
    .select()
    .single()

  if (error) return { error: 'Kunne ikkje legge til vare' }
  return { listItem: data }
}

/**
 * Tick or untick a line. Ticking also teaches the app the route: the item's position in
 * this trip (0 = first, 1 = last) is folded into its per-shop average, and into the
 * section's. `recordRoute` is false when GPS says the phone is nowhere near a shop
 * (ticking things off at home must not teach the route).
 */
export async function toggleListItem(listItemId: string, isChecked: boolean, recordRoute = true) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  const listItem = await ownedListItem(supabase, householdId, listItemId)
  if (!listItem) return NO_ACCESS

  const updates: Record<string, unknown> = {
    is_checked: isChecked,
    checked_at: isChecked ? new Date().toISOString() : null,
  }

  if (isChecked) {
    const [checkedRes, totalRes, itemRes, listRes] = await Promise.all([
      supabase.from('list_items').select('*', { count: 'exact', head: true }).eq('list_id', listItem.list_id).eq('is_checked', true),
      supabase.from('list_items').select('*', { count: 'exact', head: true }).eq('list_id', listItem.list_id),
      supabase.from('items').select('times_purchased, check_order_sum, check_count, section_id').eq('id', listItem.item_id).single(),
      supabase.from('shopping_lists').select('store_id').eq('id', listItem.list_id).single(),
    ])
    const already = checkedRes.count || 0
    const total = totalRes.count || 1
    const item = itemRes.data

    if (item) {
      // Global counters (kept for "most bought" and as a fallback order)
      await supabase
        .from('items')
        .update({
          times_purchased: (item.times_purchased || 0) + 1,
          check_order_sum: (item.check_order_sum || 0) + already + 1,
          check_count: (item.check_count || 0) + 1,
        })
        .eq('id', listItem.item_id)

      // Per-shop route, only for lists with a shop and when not ticked off at home
      const storeId = listRes.data?.store_id
      if (storeId && recordRoute && total >= 3) {
        const pos = total > 1 ? already / (total - 1) : 0.5
        await Promise.all([
          learnRoute(supabase, 'item_store_routes', { household_id: householdId, item_id: listItem.item_id, store_id: storeId }, pos),
          item.section_id
            ? learnRoute(supabase, 'section_store_routes', { household_id: householdId, section_id: item.section_id, store_id: storeId }, pos)
            : Promise.resolve(),
        ])
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
  if (!(await ownedListItem(supabase, householdId, listItemId))) return NO_ACCESS
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
  if (!(await ownsList(supabase, householdId, listId))) return NO_ACCESS
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
  if (!(await ownsList(supabase, householdId, listId))) return NO_ACCESS

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
    .eq('household_id', householdId)
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
  if (!(await ownsTemplate(supabase, householdId, templateId))) return NO_ACCESS
  await supabase.from('template_items').delete().eq('template_id', templateId)
  await supabase.from('list_templates').delete().eq('id', templateId).eq('household_id', householdId)

  revalidatePath('/lister')
  return { success: true }
}

export async function updateListItemQuantity(listItemId: string, quantity: string) {
  const householdId = await getSession()
  if (!householdId) return { error: 'Ikkje innlogga' }

  const supabase = createServiceRoleClient()
  if (!(await ownedListItem(supabase, householdId, listItemId))) return NO_ACCESS
  const { error } = await supabase
    .from('list_items')
    .update({ quantity })
    .eq('id', listItemId)

  if (error) return { error: 'Kunne ikkje oppdatere mengde' }
  return { success: true }
}
