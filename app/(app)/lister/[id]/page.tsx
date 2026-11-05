import { requireSession } from '@/lib/session'
import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getWalkOrder } from '@/lib/actions/stores'
import { ListDetailClient } from './list-detail-client'

export default async function ListDetailPage({ params }: { params: { id: string } }) {
  const householdId = requireSession()
  const supabase = createServiceRoleClient()

  // Everything the screen needs, fetched in parallel in one server round-trip:
  // the list, sections, shops, the household's items (for names + local search)
  // and the list lines themselves, so the list paints immediately.
  const [listRes, sectionsRes, storesRes, itemsRes, lineRes, hhRes] = await Promise.all([
    supabase
      .from('shopping_lists')
      .select('*, stores(id, name, chain)')
      .eq('id', params.id)
      .eq('household_id', householdId)
      .maybeSingle(),
    supabase.from('sections').select('*').order('default_sort_order'),
    supabase.from('household_stores').select('*, stores(*)').eq('household_id', householdId),
    supabase
      .from('items')
      .select('id, name, section_id, times_purchased, is_confirmed, check_order_sum, check_count')
      .eq('household_id', householdId),
    supabase.from('list_items').select('*').eq('list_id', params.id).order('created_at'),
    supabase.from('households').select('family_size').eq('id', householdId).maybeSingle(),
  ])

  const list = listRes.data
  if (!list) notFound()
  const sections = sectionsRes.data || []

  const walkOrder = list.store_id
    ? await getWalkOrder(list.store_id)
    : sections.map((s: any) => ({ section_id: s.id, walk_order: s.default_sort_order }))

  return (
    <ListDetailClient
      list={list}
      sections={sections}
      walkOrder={walkOrder}
      householdStores={storesRes.data || []}
      initialItems={itemsRes.data || []}
      initialLines={lineRes.data || []}
      householdSize={hhRes.data?.family_size ?? null}
    />
  )
}
