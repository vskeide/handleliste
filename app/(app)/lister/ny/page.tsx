'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createList, getTemplates, createListFromTemplate, deleteTemplate } from '@/lib/actions/lists'
import { getHouseholdStores } from '@/lib/actions/stores'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Bookmark, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { CHAIN_COLORS } from '@/lib/constants'

export default function NewListPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [name, setName] = useState('')
  const [storeId, setStoreId] = useState<string | undefined>()
  const [stores, setStores] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getHouseholdStores().then((data) => setStores(data))
    getTemplates().then((data) => {
      setTemplates(data)
      // Auto-create from template if URL has ?template=id
      const templateId = searchParams.get('template')
      if (templateId) {
        const tmpl = data.find((t: any) => t.id === templateId)
        if (tmpl) {
          setLoading(true)
          createListFromTemplate(tmpl.id, tmpl.name).then((result) => {
            if (result.list) router.push(`/lister/${result.list.id}`)
            else setLoading(false)
          })
        }
      }
    })
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

  async function handleUseTemplate(template: any) {
    setLoading(true)
    const result = await createListFromTemplate(template.id, template.name)
    if (result.list) {
      router.push(`/lister/${result.list.id}`)
    }
    setLoading(false)
  }

  async function handleDeleteTemplate(e: React.MouseEvent, templateId: string) {
    e.stopPropagation()
    await deleteTemplate(templateId)
    setTemplates((prev) => prev.filter((t) => t.id !== templateId))
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/lister" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-[#0F172A]">{t('lists.new')}</h1>
      </div>

      {/* Templates section */}
      {templates.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Bookmark className="h-4 w-4 text-[#64748B]" />
            <span className="text-sm font-medium text-[#64748B]">Lag frå mal</span>
          </div>
          <div className="space-y-2">
            {templates.map((template) => {
              const itemCount = template.template_items?.[0]?.count || 0
              const chainColor = template.stores?.chain ? CHAIN_COLORS[template.stores.chain] : null
              return (
                <button
                  key={template.id}
                  onClick={() => handleUseTemplate(template)}
                  disabled={loading}
                  className="flex items-center gap-3 w-full rounded-lg border border-[#E2E8F0] p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <Bookmark className="h-4 w-4 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-[#0F172A]">{template.name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {template.stores && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: chainColor?.lightBg || '#F1F5F9',
                            color: chainColor?.primary || '#64748B',
                          }}
                        >
                          {template.stores.name}
                        </span>
                      )}
                      <span className="text-xs text-[#94A3B8]">{itemCount} varer</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteTemplate(e, template.id)}
                    className="text-[#94A3B8] hover:text-red-500 flex-shrink-0 p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              )
            })}
          </div>
          <div className="border-t my-4" />
          <p className="text-xs text-[#94A3B8] text-center mb-4">eller lag ei ny tom liste</p>
        </div>
      )}

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
