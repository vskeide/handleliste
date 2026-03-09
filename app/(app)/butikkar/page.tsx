import { cookies } from 'next/headers'
import Link from 'next/link'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME, CHAIN_COLORS } from '@/lib/constants'
import { t } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { MapPin, ChevronRight } from 'lucide-react'

export default async function StoresPage() {
  const cookieStore = cookies()
  const householdId = cookieStore.get(SESSION_COOKIE_NAME)!.value

  const supabase = createServiceRoleClient()
  const { data: householdStores } = await supabase
    .from('household_stores')
    .select('*, stores(*)')
    .eq('household_id', householdId)
    .order('is_favorite', { ascending: false })

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-bold text-[#0F172A] mb-6">{t('stores.title')}</h1>

      <div className="space-y-3">
        {(householdStores || []).map((hs: any) => {
          const store = hs.stores
          const chainColor = CHAIN_COLORS[store.chain]

          return (
            <Link
              key={store.id}
              href={`/butikkar/${store.id}`}
              className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm border border-[#E2E8F0] hover:border-[#94A3B8] transition-colors"
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0"
                style={{ backgroundColor: chainColor?.lightBg || '#F1F5F9' }}
              >
                <MapPin className="h-5 w-5" style={{ color: chainColor?.primary || '#64748B' }} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-[#0F172A] truncate">{store.name}</h3>
                <p className="text-xs text-[#64748B] truncate">{store.address}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {store.is_mapped ? (
                  <Badge className="bg-[#10B981]/10 text-[#10B981] border-0 text-[10px]">
                    {t('stores.mapped')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-[#94A3B8]">
                    {t('stores.not_mapped')}
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 text-[#94A3B8]" />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
