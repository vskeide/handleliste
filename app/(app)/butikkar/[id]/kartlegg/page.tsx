import { requireSession } from '@/lib/session'
import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getWalkOrder, canEditSharedMap } from '@/lib/actions/stores'
import { SectionSorterClient } from './section-sorter-client'

export default async function MappingPage({ params }: { params: { id: string } }) {
  requireSession()

  const supabase = createServiceRoleClient()

  const [storeRes, sectionsRes, walkOrder, canEdit] = await Promise.all([
    supabase
    .from('stores')
    .select('*')
    .eq('id', params.id)
    .single(),
    supabase
    .from('sections')
    .select('*')
    .order('default_sort_order'),
    getWalkOrder(params.id),
    canEditSharedMap(params.id),
  ])
  const store = storeRes.data
  if (!store) notFound()

  return (
    <SectionSorterClient
      storeId={params.id}
      storeName={store.name}
      sections={sectionsRes.data || []}
      initialWalkOrder={walkOrder}
      canEditShared={canEdit}
    />
  )
}
