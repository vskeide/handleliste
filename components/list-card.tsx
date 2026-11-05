'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deleteList } from '@/lib/actions/lists'
import { CHAIN_COLORS } from '@/lib/constants'
import { t } from '@/lib/i18n'

interface Props {
  list: { id: string; name: string; stores?: { name: string; chain: string } | null }
  total: number
  checked: number
}

/** One list on the overview, with a delete button that asks before deleting. */
export function ListCard({ list, total, checked }: Props) {
  const router = useRouter()
  const [gone, setGone] = useState(false)
  const chainColor = list.stores?.chain ? CHAIN_COLORS[list.stores.chain] : null
  const progress = total > 0 ? (checked / total) * 100 : 0

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const what = total > 0 ? `«${list.name}» med ${total} varer` : `«${list.name}»`
    if (!confirm(`Slette ${what}? Dette kan ikkje angrast.`)) return
    setGone(true)
    const result = await deleteList(list.id)
    if ('error' in result && result.error) {
      setGone(false)
      alert(result.error)
      return
    }
    router.refresh()
  }

  if (gone) return null

  return (
    <div className="relative">
      <Link
        href={`/lister/${list.id}`}
        className="block rounded-xl bg-white p-4 pr-12 shadow-sm border border-[#E2E8F0] hover:border-[#94A3B8] transition-colors"
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
            {t('lists.items_count', 'nn', { count: total })}
          </span>
        </div>
        {total > 0 && (
          <div className="mt-3 h-1.5 rounded-full bg-[#F1F5F9] overflow-hidden">
            <div className="h-full rounded-full bg-[#10B981] transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </Link>
      <button
        onClick={handleDelete}
        aria-label={`Slett ${list.name}`}
        className="absolute right-2 top-2 p-2 rounded-lg text-[#94A3B8] hover:text-red-500 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
