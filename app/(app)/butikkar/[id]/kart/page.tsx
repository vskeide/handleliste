import { requireSession } from '@/lib/session'
import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getStoreMap, getWalkOrder, canEditSharedMap } from '@/lib/actions/stores'
import { GridMapClient } from './grid-map-client'

export default async function StoreMapPage({ params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams
  await requireSession()

  const supabase = createServiceRoleClient()

  const [storeRes, sectionsRes, storeMap, walkOrder, canEdit] = await Promise.all([
    supabase
    .from('stores')
    .select('*')
    .eq('id', params.id)
    .single(),
    supabase
    .from('sections')
    .select('*')
    .order('default_sort_order'),
    getStoreMap(params.id),
    getWalkOrder(params.id),
    canEditSharedMap(params.id),
  ])
  const store = storeRes.data
  if (!store) notFound()

  return (
    <GridMapClient
      storeId={params.id}
      storeName={store.name}
      sections={sectionsRes.data || []}
      storeMap={storeMap}
      walkOrder={walkOrder}
      canEdit={canEdit}
    />
  )
}
