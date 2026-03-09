'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createList } from '@/lib/actions/lists'
import { getHouseholdStores } from '@/lib/actions/stores'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { CHAIN_COLORS } from '@/lib/constants'

export default function NewListPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [storeId, setStoreId] = useState<string | undefined>()
  const [stores, setStores] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getHouseholdStores().then((data) => setStores(data))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)

    const result = await createList(name.trim(), storeId)
    if (result.list) {
      router.push(`/lister/${result.list.id}`)
    }
    setLoading(false)
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/lister" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-[#0F172A]">{t('lists.new')}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Namn på lista</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vekohandel"
            autoFocus
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Vel butikk (valfritt)</label>
          <div className="grid grid-cols-1 gap-2">
            {stores.map((hs: any) => {
              const store = hs.stores
              const chainColor = CHAIN_COLORS[store.chain]
              const isSelected = storeId === store.id
              return (
                <button
                  type="button"
                  key={store.id}
                  onClick={() => setStoreId(isSelected ? undefined : store.id)}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-[#E2E8F0] hover:border-[#94A3B8]'
                  }`}
                >
                  <div
                    className="h-3 w-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: chainColor?.primary || '#94A3B8' }}
                  />
                  <span className="text-sm font-medium truncate">{store.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <Button type="submit" className="w-full h-12" disabled={loading}>
          {loading ? 'Opprettar...' : t('lists.new')}
        </Button>
      </form>
    </div>
  )
}
