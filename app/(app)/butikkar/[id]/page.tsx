import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME, CHAIN_COLORS } from '@/lib/constants'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Map, ListOrdered, MapPin } from 'lucide-react'

export default async function StoreDetailPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const householdId = cookieStore.get(SESSION_COOKIE_NAME)!.value

  const supabase = createServiceRoleClient()
  const { data: store } = await supabase
    .from('stores')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!store) notFound()

  const chainColor = CHAIN_COLORS[store.chain]

  // Check if household can edit shared map
  const { data: household } = await supabase
    .from('households')
    .select('is_admin')
    .eq('id', householdId)
    .single()

  const canEditShared = household?.is_admin || store.mapped_by_household_id === householdId

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/butikkar" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-[#0F172A] truncate">{store.name}</h1>
          <p className="text-xs text-[#64748B]">{store.address}</p>
        </div>
      </div>

      <div
        className="rounded-xl p-4 mb-4"
        style={{ backgroundColor: chainColor?.lightBg || '#F1F5F9' }}
      >
        <div className="flex items-center gap-3">
          <MapPin className="h-6 w-6" style={{ color: chainColor?.primary || '#64748B' }} />
          <div>
            <p className="font-medium" style={{ color: chainColor?.primary || '#0F172A' }}>{store.chain}</p>
            <p className="text-xs text-[#64748B]">{store.city}</p>
          </div>
          {store.is_mapped && (
            <Badge className="ml-auto bg-[#10B981]/10 text-[#10B981] border-0">
              {t('stores.mapped')}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <Button asChild variant="outline" className="w-full justify-start h-12">
          <Link href={`/butikkar/${store.id}/kartlegg`}>
            <ListOrdered className="h-5 w-5 mr-3" />
            {t('stores.edit_order')}
          </Link>
        </Button>

        <Button asChild variant="outline" className="w-full justify-start h-12">
          <Link href={`/butikkar/${store.id}/kart`}>
            <Map className="h-5 w-5 mr-3" />
            {store.is_mapped ? t('stores.view_map') : t('map.title')}
          </Link>
        </Button>
      </div>

      {!canEditShared && store.is_mapped && (
        <p className="mt-4 text-xs text-[#94A3B8] text-center">
          {t('stores.already_mapped')}
        </p>
      )}
    </div>
  )
}
