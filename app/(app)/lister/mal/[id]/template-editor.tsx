'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Bookmark, Play, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QuantityPickerSheet, formatQuantityDisplay } from '@/components/quantity-picker-sheet'
import { ItemName } from '@/components/item-name'
import { createListFromTemplate, deleteTemplate } from '@/lib/actions/lists'
import {
  addTemplateItem,
  removeTemplateItem,
  renameTemplate,
  setTemplateStore,
  updateTemplateItemQuantity,
} from '@/lib/actions/templates'

interface Line { id: string; item_id: string; quantity: string; pending?: boolean }
interface Props {
  template: { id: string; name: string; store_id: string | null }
  initialLines: Line[]
  items: { id: string; name: string; section_id: string | null; times_purchased: number }[]
  sections: { id: string; name_nn: string; icon: string; default_sort_order: number }[]
  stores: { id: string; name: string; chain: string }[]
}

/** Edit a template in place. Nothing here creates a list unless "Bruk malen" is pressed. */
export function TemplateEditor({ template, initialLines, items, sections, stores }: Props) {
  const router = useRouter()
  const [name, setName] = useState(template.name)
  const [storeId, setStoreId] = useState(template.store_id)
  const [lines, setLines] = useState<Line[]>(initialLines)
  const [query, setQuery] = useState('')
  const [editingQty, setEditingQty] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const itemById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])
  const sectionById = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s])), [sections])

  const sortedLines = [...lines].sort((a, b) => {
    const ia = itemById[a.item_id], ib = itemById[b.item_id]
    const sa = sectionById[ia?.section_id ?? '']?.default_sort_order ?? 999
    const sb = sectionById[ib?.section_id ?? '']?.default_sort_order ?? 999
    return sa - sb || (ia?.name || '').localeCompare(ib?.name || '', 'nn')
  })

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('nn')
    if (!q) return []
    const onTemplate = new Set(lines.map((l) => l.item_id))
    return items
      .filter((i) => !onTemplate.has(i.id) && i.name.toLocaleLowerCase('nn').includes(q))
      .sort((a, b) => {
        const as = a.name.toLocaleLowerCase('nn').startsWith(q) ? 0 : 1
        const bs = b.name.toLocaleLowerCase('nn').startsWith(q) ? 0 : 1
        return as - bs || (b.times_purchased || 0) - (a.times_purchased || 0)
      })
      .slice(0, 15)
  }, [query, items, lines])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(null), 3000)
  }

  async function saveName() {
    const n = name.trim()
    if (!n || n === template.name) { setName(n || template.name); return }
    const r = await renameTemplate(template.id, n)
    if ('error' in r && r.error) flash(r.error)
  }

  async function changeStore(id: string) {
    const next = id || null
    setStoreId(next)
    const r = await setTemplateStore(template.id, next)
    if ('error' in r && r.error) flash(r.error)
  }

  function addItem(itemId: string) {
    setQuery('')
    searchRef.current?.focus()
    const tempId = `tmp-${itemId}`
    setLines((prev) => [...prev, { id: tempId, item_id: itemId, quantity: '1', pending: true }])
    addTemplateItem(template.id, itemId).then((r) => {
      if ('templateItem' in r && r.templateItem) {
        setLines((prev) => prev.map((l) => (l.id === tempId ? r.templateItem : l)))
      } else {
        setLines((prev) => prev.filter((l) => l.id !== tempId))
        flash(('error' in r && r.error) || 'Kunne ikkje legge til vare')
      }
    })
  }

  async function removeLine(line: Line) {
    setLines((prev) => prev.filter((l) => l.id !== line.id))
    if (line.pending) return
    const r = await removeTemplateItem(line.id)
    if ('error' in r && r.error) { setLines((prev) => [...prev, line]); flash(r.error) }
  }

  async function changeQty(lineId: string, quantity: string) {
    setEditingQty(null)
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity } : l)))
    const r = await updateTemplateItemQuantity(lineId, quantity)
    if ('error' in r && r.error) flash(r.error)
  }

  async function useTemplate() {
    setBusy(true)
    const r = await createListFromTemplate(template.id, name.trim() || template.name)
    if ('list' in r && r.list) router.push(`/lister/${r.list.id}`)
    else { setBusy(false); flash(('error' in r && r.error) || 'Kunne ikkje lage liste') }
  }

  async function removeTemplate() {
    if (!confirm(`Slette malen «${name}»? Lister du alt har laga frå han blir ikkje rørt.`)) return
    setBusy(true)
    const r = await deleteTemplate(template.id)
    if ('error' in r && r.error) { setBusy(false); flash(r.error); return }
    router.push('/lister')
    router.refresh()
  }

  const editingLine = lines.find((l) => l.id === editingQty)

  return (
    <div className="mx-auto max-w-lg pb-40">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <Link href="/lister" className="text-[#64748B] hover:text-[#0F172A] flex-shrink-0" aria-label="Tilbake">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Bookmark className="h-4 w-4 text-primary flex-shrink-0" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="h-9 text-lg font-bold border-0 shadow-none px-1 focus-visible:ring-1"
            aria-label="Namn på malen"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-[#64748B]">
          <span>Mal · {lines.length} varer ·</span>
          <select
            value={storeId ?? ''}
            onChange={(e) => changeStore(e.target.value)}
            className="bg-transparent text-xs text-[#0F172A] border rounded px-1 py-0.5"
            aria-label="Butikk"
          >
            <option value="">Ingen butikk</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Add items */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 rounded-lg border bg-white px-3">
          <Search className="h-4 w-4 text-[#94A3B8] flex-shrink-0" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); addItem(results[0].id) } }}
            placeholder="Legg til vare i malen…"
            className="border-0 shadow-none focus-visible:ring-0 h-10 px-0"
          />
          {query && <button onClick={() => setQuery('')} aria-label="Tøm"><X className="h-4 w-4 text-[#94A3B8]" /></button>}
        </div>
        {query && (
          <div className="mt-1 rounded-lg border bg-white divide-y">
            {results.length === 0 ? (
              <p className="p-3 text-sm text-[#94A3B8]">Ingen treff. Nye varer legg du til frå ei handleliste.</p>
            ) : results.map((it) => (
              <button
                key={it.id}
                onClick={() => addItem(it.id)}
                className="flex items-center gap-2 w-full p-2.5 text-left text-sm hover:bg-[#F1F5F9]"
              >
                <span>{sectionById[it.section_id ?? '']?.icon || '📦'}</span>
                <span className="flex-1">{it.name}</span>
                <Plus className="h-4 w-4 text-primary" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="px-4 py-3 space-y-1">
        {sortedLines.length === 0 && <p className="text-center text-sm text-[#94A3B8] py-8">Malen er tom</p>}
        {sortedLines.map((line) => {
          const it = itemById[line.item_id]
          const sec = sectionById[it?.section_id ?? '']
          return (
            <div key={line.id} className={`flex items-center gap-3 rounded-lg bg-white p-3 border border-[#E2E8F0] ${line.pending ? 'opacity-60' : ''}`}>
              <span className="text-sm">{sec?.icon || '📦'}</span>
              <ItemName name={it?.name || 'Ukjend vare'} className="flex-1 min-w-0 text-sm text-[#0F172A]" />
              <button
                onClick={() => !line.pending && setEditingQty(line.id)}
                className={`text-sm min-w-[2rem] text-center px-2 py-1 rounded-lg border ${
                  line.quantity === '1' ? 'text-[#94A3B8] border-[#E2E8F0]' : 'bg-[#D1FAE5] text-[#059669] font-semibold border-[#A7F3D0]'
                }`}
              >
                {formatQuantityDisplay(line.quantity)}
              </button>
              <button onClick={() => removeLine(line)} className="text-[#94A3B8] hover:text-red-500" aria-label={`Fjern ${it?.name}`}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-30">
        <div className="mx-auto max-w-lg px-4 flex gap-2">
          <Button onClick={useTemplate} disabled={busy || lines.length === 0} className="flex-1 h-12 shadow-lg">
            <Play className="h-4 w-4 mr-2" /> Lag handleliste frå malen
          </Button>
          <Button onClick={removeTemplate} disabled={busy} variant="outline" className="h-12 bg-white text-red-600 border-red-200 shadow-lg" aria-label="Slett malen">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {notice && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-[#0F172A] text-white text-sm px-4 py-2 shadow-lg">
          {notice}
        </div>
      )}

      {editingLine && (
        <QuantityPickerSheet
          currentQuantity={editingLine.quantity}
          onSave={(q) => changeQty(editingLine.id, q)}
          onClose={() => setEditingQty(null)}
        />
      )}
    </div>
  )
}
