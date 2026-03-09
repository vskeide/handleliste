import { cookies } from 'next/headers'
import Link from 'next/link'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Plus, ShoppingCart } from 'lucide-react'
import { CHAIN_COLORS } from '@/lib/constants'

export default async function ListsPage() {
  const cookieStore = cookies()
  const householdId = cookieStore.get(SESSION_COOKIE_NAME)!.value

  const supabase = createServiceRoleClient()
  const { data: lists } = await supabase
    .from('shopping_lists')
    .select('*, stores(name, chain)')
    .eq('household_id', householdId)
    .eq('is_active', true)
    .eq('is_template', false)
    .order('updated_at', { ascending: false })

  // Get item counts per list
  const listIds = (lists || []).map((l: { id: string }) => l.id)
  let itemCounts: Record<string, { total: number; checked: number }> = {}

  if (listIds.length > 0) {
    const { data: items } = await supabase
      .from('list_items')
      .select('list_id, is_checked')
      .in('list_id', listIds)

    if (items) {
      for (const item of items) {
        if (!itemCounts[item.list_id]) {
          itemCounts[item.list_id] = { total: 0, checked: 0 }
        }
        itemCounts[item.list_id].total++
        if (item.is_checked) itemCounts[item.list_id].checked++
      }
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#0F172A]">{t('lists.title')}</h1>
        <Button asChild size="icon" className="rounded-full h-10 w-10">
          <Link href="/lister/ny">
            <Plus className="h-5 w-5" />
          </Link>
        </Button>
      </div>

      {(!lists || lists.length === 0) ? (
        <div className="text-center py-12">
          <ShoppingCart className="mx-auto h-12 w-12 text-[#94A3B8] mb-3" />
          <p className="text-[#64748B]">Ingen lister enno</p>
          <Button asChild className="mt-4">
            <Link href="/lister/ny">{t('lists.new')}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map((list: any) => {
            const counts = itemCounts[list.id] || { total: 0, checked: 0 }
            const chainColor = list.stores?.chain ? CHAIN_COLORS[list.stores.chain] : null
            const progress = counts.total > 0 ? (counts.checked / counts.total) * 100 : 0

            return (
              <Link
                key={list.id}
                href={`/lister/${list.id}`}
                className="block rounded-xl bg-white p-4 shadow-sm border border-[#E2E8F0] hover:border-[#94A3B8] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-[#0F172A] truncate">{list.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {list.stores ? (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: chainColor?.lightBg || '#F1F5F9',
                            color: chainColor?.primary || '#64748B',
                          }}
                        >
                          {list.stores.name}
                        </span>
                      ) : (
                        <span className="text-xs text-[#94A3B8]">{t('lists.no_store')}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-sm text-[#64748B] whitespace-nowrap ml-2">
                    {t('lists.items_count', 'nn', { count: counts.total })}
                  </span>
                </div>
                {counts.total > 0 && (
                  <div className="mt-3 h-1.5 rounded-full bg-[#F1F5F9] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#10B981] transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
