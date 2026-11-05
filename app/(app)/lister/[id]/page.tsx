import { requireSession } from '@/lib/session'
import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getWalkOrder } from '@/lib/actions/stores'
import { ListDetailClient } from './list-detail-client'
import { portions, describeHousehold } from '@/lib/portions'
import { getMeals } from '@/lib/actions/meals'

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
    supabase.from('list_items').select('*').eq('list_id', params.id).order('created_at'),
    supabase.from('households').select('*').eq('id', householdId).maybeSingle(),
    getMeals(),
  ])

  const list = listRes.data
  if (!list) notFound()
  const sections = sectionsRes.data || []

  // Learned routes for this shop (migration 0005; empty if not run yet)
  const [walkOrder, itemRouteRes, sectionRouteRes] = await Promise.all([
    list.store_id
      ? getWalkOrder(list.store_id)
      : Promise.resolve(sections.map((s: any) => ({ section_id: s.id, walk_order: s.default_sort_order }))),
    list.store_id
      ? supabase.from('item_store_routes').select('item_id, avg_pos, n').eq('household_id', householdId).eq('store_id', list.store_id)
      : Promise.resolve({ data: [] as any[] }),
    list.store_id
      ? supabase.from('section_store_routes').select('section_id, avg_pos, n').eq('store_id', list.store_id)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const itemRoutes: Record<string, { avg: number; n: number }> = {}
  for (const r of (itemRouteRes as any).data || []) itemRoutes[r.item_id] = { avg: r.avg_pos, n: r.n }

  // Section order shared across households: average weighted by how many ticks each has
  const sectionRoutes: Record<string, { avg: number; n: number }> = {}
  for (const r of (sectionRouteRes as any).data || []) {
    const s = sectionRoutes[r.section_id] ?? { avg: 0, n: 0 }
    const n = s.n + r.n
    sectionRoutes[r.section_id] = { avg: (s.avg * s.n + r.avg_pos * r.n) / n, n }
  }

  return (
    <ListDetailClient
      key={list.id}
      initialMeals={initialMeals}
      list={list}
      sections={sections}
      walkOrder={walkOrder}
      householdStores={storesRes.data || []}
      initialItems={itemsRes.data || []}
      initialLines={lineRes.data || []}
      householdSize={portions(hhRes.data as any)}
      householdLabel={describeHousehold(hhRes.data as any)}
      itemRoutes={itemRoutes}
      sectionRoutes={sectionRoutes}
    />
  )
}
