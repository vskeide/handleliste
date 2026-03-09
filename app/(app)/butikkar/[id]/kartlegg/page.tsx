import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { getWalkOrder, canEditSharedMap } from '@/lib/actions/stores'
import { SectionSorterClient } from './section-sorter-client'

export default async function MappingPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const householdId = cookieStore.get(SESSION_COOKIE_NAME)!.value

  const supabase = createServiceRoleClient()

  const { data: store } = await supabase
    .from('stores')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!store) notFound()

  const { data: sections } = await supabase
    .from('sections')
    .select('*')
    .order('default_sort_order')

  const walkOrder = await getWalkOrder(params.id)
  const canEdit = await canEditSharedMap(params.id)

  return (
    <SectionSorterClient
      storeId={params.id}
      storeName={store.name}
      sections={sections || []}
      initialWalkOrder={walkOrder}
      canEditShared={canEdit}
    />
  )
}
