import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { getWalkOrder } from '@/lib/actions/stores'
import { ListDetailClient } from './list-detail-client'

export default async function ListDetailPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const householdId = cookieStore.get(SESSION_COOKIE_NAME)!.value
  const supabase = createServiceRoleClient()

  const { data: list } = await supabase
    .from('shopping_lists')
    .select('*, stores(id, name, chain)')
    .eq('id', params.id)
    .eq('household_id', householdId)
    .single()

  if (!list) notFound()

  // Get sections
  const { data: sections } = await supabase
    .from('sections')
    .select('*')
    .order('default_sort_order')

  // Get walk order for this store (if assigned)
  const walkOrder = list.store_id
    ? await getWalkOrder(list.store_id)
    : (sections || []).map((s: any) => ({ section_id: s.id, walk_order: s.default_sort_order }))

  // Get all household stores for the store selector
  const { data: householdStores } = await supabase
    .from('household_stores')
    .select('*, stores(*)')
    .eq('household_id', householdId)

  return (
    <ListDetailClient
      list={list}
      sections={sections || []}
      walkOrder={walkOrder}
      householdStores={householdStores || []}
    />
  )
}
