import { requireSession } from '@/lib/session'
import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getWalkOrder } from '@/lib/actions/stores'
import { ListDetailClient } from './list-detail-client'
import { portions, describeHousehold } from '@/lib/portions'
import { getMeals } from '@/lib/actions/meals'
import { routeRanks, combineRoutePairs, type RoutePair } from '@/lib/route-order'

export default async function ListDetailPage({ params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams
  const householdId = await requireSession()
  const supabase = createServiceRoleClient()

  // Everything the screen needs, fetched in parallel in one server round-trip:
  // the list, sections, shops, the household's items (for names + local search)
  // and the list lines themselves, so the list paints immediately.
  const [listRes, sectionsRes, storesRes, itemsRes, lineRes, hhRes, initialMeals] = await Promise.all([
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
    supabase.rpc('get_list_contents', { p_household: householdId, p_list: params.id }),
    supabase.from('households').select('*').eq('id', householdId).maybeSingle(),
    getMeals(),
  ])

  const list = listRes.data
  if (!list) notFound()
  const sections = sectionsRes.data || []

  // Relative comparisons for this shop; no assumptions about unpicked products.
  const [walkOrder, itemRouteRes, sectionRouteRes] = await Promise.all([
    list.store_id
      ? getWalkOrder(list.store_id)
      : Promise.resolve(sections.map((s: any) => ({ section_id: s.id, walk_order: s.default_sort_order }))),
    list.store_id
      ? supabase.from('item_route_pairs').select('a_id, b_id, a_before_b, n').eq('household_id', householdId).eq('store_id', list.store_id)
      : Promise.resolve({ data: [] as any[] }),
    list.store_id
      ? supabase.from('section_route_pairs').select('a_id, b_id, a_before_b, n').eq('store_id', list.store_id)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const walk = new Map(walkOrder.map(w => [w.section_id, w.walk_order]))
  const sectionIds = [...sections].sort((a,b) => (walk.get(a.id) ?? a.default_sort_order) - (walk.get(b.id) ?? b.default_sort_order)).map(s => s.id)
  const sectionRoutes = routeRanks(sectionIds, combineRoutePairs((sectionRouteRes.data || []) as RoutePair[]))
  const maxWalk = Math.max(1, ...walkOrder.map(w => w.walk_order))
  const sectionPosition = (id: string | null) => id && sectionRoutes[id]?.n >= 2
    ? sectionRoutes[id].avg : (id ? walk.get(id) ?? maxWalk : maxWalk) / maxWalk
  const itemIds = [...(itemsRes.data || [])].sort((a,b) => sectionPosition(a.section_id) - sectionPosition(b.section_id)
    || a.name.localeCompare(b.name,'nn')).map(item => item.id)
  const itemRoutes = routeRanks(itemIds, (itemRouteRes.data || []) as RoutePair[])

  return (
    <ListDetailClient
      key={list.id}
      initialMeals={initialMeals}
      list={list}
      sections={sections}
      walkOrder={walkOrder}
      householdStores={storesRes.data || []}
      initialItems={itemsRes.data || []}
      initialLines={lineRes.data?.lines || []}
      initialListMeals={lineRes.data?.meals || []}
      householdSize={portions(hhRes.data as any)}
      householdLabel={describeHousehold(hhRes.data as any)}
      itemRoutes={itemRoutes}
      sectionRoutes={sectionRoutes}
    />
  )
}
