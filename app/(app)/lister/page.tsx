import { requireSession } from '@/lib/session'
import Link from 'next/link'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Plus, ShoppingCart, Bookmark } from 'lucide-react'
import { CHAIN_COLORS } from '@/lib/constants'
import { ListCard } from '@/components/list-card'

export default async function ListsPage() {
  const householdId = requireSession()

  const supabase = createServiceRoleClient()
  const { data: lists } = await supabase
    .from('shopping_lists')
    .select('*, stores(name, chain)')
    .eq('household_id', householdId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })

  // Templates ("malar") are shown on the new-list page behind the + button, not here
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
            return <ListCard key={list.id} list={list} total={counts.total} checked={counts.checked} />
          })}
        </div>
      )}
    </div>
  )
}
