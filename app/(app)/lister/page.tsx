import { cookies } from 'next/headers'
import Link from 'next/link'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Plus, ShoppingCart, Bookmark } from 'lucide-react'
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
    .order('updated_at', { ascending: false })

  // Fetch templates
  const { data: templates } = await supabase
    .from('list_templates')
    .select('*, template_items(count), stores(name, chain)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })

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

      {/* Templates */}
      {templates && templates.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Bookmark className="h-4 w-4 text-[#64748B]" />
            <span className="text-sm font-medium text-[#64748B]">Malar</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {templates.map((tmpl: any) => {
              const cc = tmpl.stores?.chain ? CHAIN_COLORS[tmpl.stores.chain] : null
              const count = tmpl.template_items?.[0]?.count || 0
              return (
                <Link
                  key={tmpl.id}
                  href={`/lister/ny?template=${tmpl.id}`}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 hover:border-primary transition-colors"
                >
                  <span className="text-xs font-medium text-[#0F172A] line-clamp-1">{tmpl.name}</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    {tmpl.stores && (
                      <span
                        className="text-[8px] px-1 py-0.5 rounded-full font-medium truncate max-w-[80px]"
                        style={{
                          backgroundColor: cc?.lightBg || '#F1F5F9',
                          color: cc?.primary || '#64748B',
                        }}
                      >
                        {tmpl.stores.name}
                      </span>
                    )}
                    <span className="text-[9px] text-[#94A3B8]">{count} varer</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

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
