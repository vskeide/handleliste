'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { t } from '@/lib/i18n'
import { CHAIN_COLORS } from '@/lib/constants'
import { useRealtimeList } from '@/lib/hooks/use-realtime-list'
import { toggleListItem, addItemToList, removeListItem, uncheckAllItems, updateListItemQuantity } from '@/lib/actions/lists'
import { updateList, deleteList, saveAsTemplate } from '@/lib/actions/lists'
import { createItemAndAddToList, getHouseholdItems, updateItemSection } from '@/lib/actions/items'
import { getMeals, addMealToList } from '@/lib/actions/meals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { QuantityPickerSheet, formatQuantityDisplay, parseQuantity } from '@/components/quantity-picker-sheet'
import { NextItemMode, type NextItemEntry } from '@/components/next-item-mode'
import { ItemName } from '@/components/item-name'
import { useOutbox, isNetworkError, type OutboxOp } from '@/lib/hooks/use-outbox'
import { ArrowLeft, Plus, Search, X, Check, Trash2, Map, Store, RotateCcw, Bookmark, MoreVertical, UtensilsCrossed, Shuffle, ArrowRightLeft, Play, Pencil, CloudOff } from 'lucide-react'
import type { Section, WalkOrder, ListItem } from '@/lib/types'

interface Props {
  list: any
  sections: Section[]
  walkOrder: WalkOrder[]
  householdStores: any[]
  initialItems: any[]
  initialLines: ListItem[]
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
}

/** Rank household items against what the user has typed. Runs on the phone, instantly. */
function searchLocal(all: any[], query: string, limit = 20) {
  const q = query.trim().toLocaleLowerCase('nn')
  if (!q) return []
  const scored: { item: any; score: number }[] = []
  for (const item of all) {
    const name = (item.name || '').toLocaleLowerCase('nn')
    const at = name.indexOf(q)
    if (at < 0) continue
    // 0 = starts with, 1 = a word starts with, 2 = anywhere
    const rank = at === 0 ? 0 : /[\s(\-/]/.test(name[at - 1]) ? 1 : 2
    scored.push({ item, score: rank * 1e6 - (item.times_purchased || 0) * 100 + name.length })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, limit).map((s) => s.item)
}

export function ListDetailClient({ list, sections, walkOrder, householdStores, initialItems, initialLines }: Props) {
  const router = useRouter()
  const { items: listItems, loading, refetch, notifyChanged, optimisticToggle, optimisticRemove, optimisticUpdateQuantity, optimisticAdd, confirmAdd, rollbackAdd } = useRealtimeList(list.id, initialLines)
  const [notice, setNotice] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [highlightIndex, setHighlightIndex] = useState(0)
  // (the add bar is always visible now; no showSearch state)
  const [showStoreSelector, setShowStoreSelector] = useState(false)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showTemplateSave, setShowTemplateSave] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [meals, setMeals] = useState<any[]>([])
  const [mealResults, setMealResults] = useState<any[]>([])
  const [movingItemId, setMovingItemId] = useState<string | null>(null)
  const [frihandelMode, setFrihandelMode] = useState(false)
  const [editingQuantityId, setEditingQuantityId] = useState<string | null>(null)
  const [showNextMode, setShowNextMode] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [itemsMap, setItemsMap] = useState<Record<string, any>>(() => {
    const map: Record<string, any> = {}
    for (const item of initialItems) map[item.id] = item
    return map
  })

  // Items arrive with the page. Only refetch them if a line shows up for an item we
  // don't know yet (created on the other phone).
  const unknownItem = listItems.some((li) => !itemsMap[li.item_id])
  useEffect(() => {
    if (!unknownItem) return
    getHouseholdItems().then((results) => {
      setItemsMap((prev) => {
        const map = { ...prev }
        for (const item of results) map[item.id] = { ...prev[item.id], ...item }
        return map
      })
    })
  }, [unknownItem])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    getMeals().then(setMeals)
  }, [])

  const sectionMap: Record<string, Section> = {}
  sections.forEach((s) => { sectionMap[s.id] = s })
  const walkOrderMap: Record<string, number> = {}
  walkOrder.forEach((wo) => { walkOrderMap[wo.section_id] = wo.walk_order })

  // Group items by section, sorted by walk order
  const uncheckedItems = listItems.filter((li) => !li.is_checked)
  const checkedItems = listItems.filter((li) => li.is_checked)

  const groupedItems: Record<string, typeof listItems> = {}
  for (const li of uncheckedItems) {
    const item = itemsMap[li.item_id]
    const sectionId = item?.section_id || 'unknown'
    if (!groupedItems[sectionId]) groupedItems[sectionId] = []
    groupedItems[sectionId].push(li)
  }

  const sortedGroups = Object.entries(groupedItems)
    .sort(([a], [b]) => (walkOrderMap[a] ?? 999) - (walkOrderMap[b] ?? 999))

  // Walking order for "next item" mode: same order the current view shows
  const learnedPos = (li: { item_id: string }) => {
    const it = itemsMap[li.item_id]
    return it?.check_count > 0 ? it.check_order_sum / it.check_count : 999
  }
  const byLearned = (a: { item_id: string }, b: { item_id: string }) =>
    learnedPos(a) - learnedPos(b) ||
    (itemsMap[a.item_id]?.name || '').localeCompare(itemsMap[b.item_id]?.name || '', 'nn')
  const routeItems = frihandelMode
    ? [...uncheckedItems].sort(byLearned)
    : sortedGroups.flatMap(([, group]) => [...group].sort(byLearned))
  const nextModeEntries: NextItemEntry[] = routeItems
    .filter((li) => itemsMap[li.item_id])
    .map((li) => {
      const item = itemsMap[li.item_id]
      const section = sectionMap[item.section_id]
      return {
        listItemId: li.id,
        name: item.name,
        quantity: li.quantity,
        sectionName: section?.name_nn,
        sectionIcon: section?.icon,
        sectionColor: section?.color,
      }
    })

  // Search runs locally over the household's items: no network, so results are always
  // current when Enter is pressed.
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query)
    setShowSectionPicker(false)
    if (query.trim().length < 1) {
      setSearchResults([])
      setMealResults([])
      return
    }
    // Items already on the list stay in the results, marked with their quantity, so
    // picking one again adds to the quantity instead of silently doing nothing
    setSearchResults(searchLocal(Object.values(itemsMap), query))
    const lq = query.toLowerCase()
    setMealResults(meals.filter((m) => m.name.toLowerCase().includes(lq)))
    setHighlightIndex(0)
  }, [listItems, meals, itemsMap])

  function resetSearch() {
    setSearchQuery('')
    setSearchResults([])
    setMealResults([])
    // Keep search open and focused for quick consecutive adds
    searchRef.current?.focus()
  }

  function handleAddItem(itemId: string) {
    resetSearch()

    const name = itemsMap[itemId]?.name || 'Vara'

    // Already on the list and not ticked: add one more (pieces), or open the amount
    // picker when it is measured in g, L etc., where "one more" has no obvious meaning
    const active = listItems.find((li) => li.item_id === itemId && !li.is_checked)
    if (active) {
      const { amount, unit } = parseQuantity(active.quantity)
      if (unit === 'stk') {
        const next = String(amount + 1)
        handleQuantityUpdate(active.id, next)
        setNotice(`${name}: ×${next}`)
      } else {
        setEditingQuantityId(active.id)
      }
      return
    }

    // Already on the list but ticked off: untick it
    const ticked = listItems.find((li) => li.item_id === itemId && li.is_checked)
    if (ticked) { handleToggle(ticked.id, true); setNotice(`${name} er tilbake på lista`); return }

    // Show the line now, store it in the background (or queue it if there is no signal)
    const clientId = newId()
    optimisticAdd(draftLine(clientId, itemId), true)
    send({ kind: 'add', clientId, itemId })
  }

  function draftLine(clientId: string, itemId: string, quantity = '1'): ListItem {
    return {
      id: clientId, list_id: list.id, item_id: itemId, quantity, is_checked: false,
      checked_at: null, sort_override: null, created_at: new Date().toISOString(),
    }
  }

  // ── Sending writes, with an offline queue ─────────────────────────────────────
  function runOp(op: OutboxOp): Promise<unknown> {
    switch (op.kind) {
      case 'add': return addItemToList(list.id, op.itemId, op.quantity, op.clientId)
      case 'create': return createItemAndAddToList(list.id, op.name, op.sectionId, op.itemId, op.clientId)
      case 'toggle': return toggleListItem(op.listItemId, op.checked)
      case 'qty': return updateListItemQuantity(op.listItemId, op.quantity)
      case 'remove': return removeListItem(op.listItemId)
    }
  }

  /** The server answered an op (now or after the queue drained). */
  function opAnswered(op: OutboxOp, result: any) {
    if (op.kind === 'add' || op.kind === 'create') {
      if (result && result.listItem) confirmAdd(op.clientId, result.listItem)
      else { rollbackAdd(op.clientId); setNotice(result?.error || 'Kunne ikkje legge til vare') }
    }
  }

  const outbox = useOutbox(list.id, runOp, opAnswered, () => { refetch(); notifyChanged() })

  /** Send now; with no signal, keep it on the phone and send later. */
  function send(op: OutboxOp) {
    // Anything already waiting must go first, to keep the order
    if (outbox.waiting > 0) { outbox.enqueue(op); return }
    runOp(op)
      .then((result) => { opAnswered(op, result); notifyChanged() })
      .catch((e) => {
        if (isNetworkError(e)) {
          outbox.enqueue(op)
          setNotice('Ingen nett – blir lagra når du er på nett att')
        } else if (op.kind === 'add' || op.kind === 'create') {
          rollbackAdd(op.clientId)
          setNotice('Kunne ikkje lagre')
        }
      })
  }

  // Ops left in the queue from an earlier visit: show them again until they are sent
  useEffect(() => {
    for (const op of outbox.queued()) {
      if (op.kind === 'create') {
        const section = sections.find((s) => s.id === op.sectionId)
        setItemsMap((prev) => prev[op.itemId] ? prev : ({
          ...prev,
          [op.itemId]: { id: op.itemId, name: op.name, section_id: op.sectionId, times_purchased: 0, is_confirmed: false, check_count: 0, check_order_sum: 0, sections: section },
        }))
        optimisticAdd(draftLine(op.clientId, op.itemId), true)
      } else if (op.kind === 'add') optimisticAdd(draftLine(op.clientId, op.itemId, op.quantity), true)
      else if (op.kind === 'toggle') optimisticToggle(op.listItemId, op.checked)
      else if (op.kind === 'qty') optimisticUpdateQuantity(op.listItemId, op.quantity)
      else if (op.kind === 'remove') optimisticRemove(op.listItemId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after the queue is loaded
  }, [])

  function handleCreateAndAdd(sectionId: string) {
    const name = newItemName.trim()
    if (!name) return
    setNewItemName('')
    setShowSectionPicker(false)
    resetSearch()

    const itemId = newId()
    const clientId = newId()
    const section = sections.find((s) => s.id === sectionId)
    setItemsMap((prev) => ({
      ...prev,
      [itemId]: { id: itemId, name, section_id: sectionId, times_purchased: 0, is_confirmed: false, check_count: 0, check_order_sum: 0, sections: section },
    }))
    optimisticAdd(draftLine(clientId, itemId), true)
    send({ kind: 'create', clientId, itemId, name, sectionId })
  }

  async function handleAddMeal(mealId: string) {
    await addMealToList(mealId, list.id)
    await refetch()
    notifyChanged()
    setSearchQuery('')
    setSearchResults([])
    setMealResults([])
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  async function handleMoveItem(itemId: string, newSectionId: string) {
    await updateItemSection(itemId, newSectionId)
    // Update local itemsMap
    setItemsMap((prev) => {
      const item = prev[itemId]
      if (!item) return prev
      const newSection = sections.find((s) => s.id === newSectionId)
      return { ...prev, [itemId]: { ...item, section_id: newSectionId, sections: newSection } }
    })
    setMovingItemId(null)
  }

  function handleToggle(listItemId: string, currentChecked: boolean) {
    optimisticToggle(listItemId, !currentChecked)
    send({ kind: 'toggle', listItemId, checked: !currentChecked })
  }

  function handleQuantityUpdate(listItemId: string, quantity: string) {
    optimisticUpdateQuantity(listItemId, quantity)
    setEditingQuantityId(null)
    send({ kind: 'qty', listItemId, quantity })
  }

  function handleRemove(listItemId: string) {
    optimisticRemove(listItemId)
    send({ kind: 'remove', listItemId })
  }

  async function handleStoreChange(storeId: string) {
    await updateList(list.id, { store_id: storeId })
    setShowStoreSelector(false)
    router.refresh()
  }

  async function handleUncheckAll() {
    await uncheckAllItems(list.id)
    await refetch()
    notifyChanged()
    setShowMenu(false)
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) return
    await saveAsTemplate(list.id, templateName.trim())
    setTemplateName('')
    setShowTemplateSave(false)
    setShowMenu(false)
  }

  async function handleDeleteList() {
    if (confirm('Slette denne lista?')) {
      await deleteList(list.id)
      router.push('/lister')
    }
  }

  const chainColor = list.stores?.chain ? CHAIN_COLORS[list.stores.chain] : null
  const totalItems = listItems.length
  const checkedCount = checkedItems.length
  const progress = totalItems > 0 ? (checkedCount / totalItems) * 100 : 0

  return (
    <div className="mx-auto max-w-lg">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/lister" className="text-[#64748B] hover:text-[#0F172A] flex-shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-bold text-[#0F172A] truncate">{list.name}</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setFrihandelMode(!frihandelMode)}
              className={`p-1 rounded ${frihandelMode ? 'text-primary bg-primary/10' : 'text-[#64748B]'}`}
              title={frihandelMode ? 'Kategori-modus' : 'Frihandel-modus'}
            >
              <Shuffle className="h-5 w-5" />
            </button>
            {uncheckedItems.length > 0 && (
              <button
                onClick={() => setShowNextMode(true)}
                className="p-1 rounded text-[#64748B]"
                title="Neste vare (fullskjerm)"
              >
                <Play className="h-5 w-5" />
              </button>
            )}
            {list.stores && list.store_id && (
              <Link href={`/butikkar/${list.store_id}/kart`} className="text-[#64748B]">
                <Map className="h-5 w-5" />
              </Link>
            )}
            <button onClick={() => searchRef.current?.focus()} className="text-[#64748B]" aria-label="Legg til vare">
              <Plus className="h-5 w-5" />
            </button>
            <div className="relative">
              <button onClick={() => setShowMenu(!showMenu)} className="text-[#64748B]">
                <MoreVertical className="h-5 w-5" />
              </button>
              {showMenu && (
                <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border py-1 w-48 z-50">
                  {checkedCount > 0 && (
                    <button
                      onClick={handleUncheckAll}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-[#F1F5F9]"
                    >
                      <RotateCcw className="h-4 w-4 text-[#64748B]" />
                      Nullstill liste
                    </button>
                  )}
                  {totalItems > 0 && (
                    <button
                      onClick={() => { setShowTemplateSave(true); setShowMenu(false); setTemplateName(list.name) }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-[#F1F5F9]"
                    >
                      <Bookmark className="h-4 w-4 text-[#64748B]" />
                      Lagre som mal
                    </button>
                  )}
                  <button
                    onClick={() => { handleDeleteList(); setShowMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-[#F1F5F9] text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                    Slett liste
                  </button>
                </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Save as template modal */}
        {showTemplateSave && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTemplate() }}
              placeholder="Namn på mal..."
              className="h-8 text-sm"
              autoFocus
            />
            <Button onClick={handleSaveTemplate} size="sm" className="h-8 px-3">
              Lagre
            </Button>
            <button onClick={() => setShowTemplateSave(false)}>
              <X className="h-4 w-4 text-[#94A3B8]" />
            </button>
          </div>
        )}

        {/* Store badge + progress */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => setShowStoreSelector(!showStoreSelector)}
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: chainColor?.lightBg || '#F1F5F9',
              color: chainColor?.primary || '#64748B',
            }}
          >
            {list.stores?.name || t('lists.no_store')} · {t('list.switch_store')}
          </button>
          {outbox.waiting > 0 && (
            <span
              className="flex items-center gap-1 text-[11px] font-medium text-[#B45309] bg-[#FEF3C7] rounded-full px-2 py-0.5"
              title="Endringar som ventar på nett"
            >
              <CloudOff className="h-3 w-3" /> {outbox.waiting}
            </span>
          )}
          {totalItems > 0 && (
            <span className="text-xs text-[#94A3B8] ml-auto">
              {checkedCount}/{totalItems}
            </span>
          )}
        </div>
        {totalItems > 0 && (
          <div className="mt-2 h-1 rounded-full bg-[#F1F5F9] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#10B981] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Store selector dropdown */}
      {showStoreSelector && (
        <>
        <div className="fixed inset-0 z-30" onClick={() => setShowStoreSelector(false)} />
        <div className="relative z-40 border-b bg-white px-4 py-3 space-y-2">
          {householdStores.map((hs: any) => {
            const store = hs.stores
            const cc = CHAIN_COLORS[store.chain]
            return (
              <button
                key={store.id}
                onClick={() => handleStoreChange(store.id)}
                className="flex items-center gap-2 w-full rounded-lg border p-2 text-left hover:bg-[#F1F5F9]"
              >
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cc?.primary || '#94A3B8' }} />
                <span className="text-sm">{store.name}</span>
              </button>
            )
          })}
        </div>
        </>
      )}

      {/* Add bar: always visible, fixed just above the bottom navigation, with
          results opening upwards so the thumb never has to reach the top */}
      <div className="fixed left-0 right-0 bottom-[65px] z-40 pointer-events-none">
        <div className="mx-auto max-w-lg px-3 pointer-events-auto">
          {(searchQuery.length > 0 || showSectionPicker) && (
          <div className="mb-1 max-h-[45vh] overflow-y-auto rounded-xl border bg-white px-3 py-2 shadow-lg">

          {/* Meal results */}
          {mealResults.length > 0 && (
            <div className="mt-2 space-y-1">
              {mealResults.map((meal: any) => {
                const count = meal.meal_items?.[0]?.count || 0
                return (
                  <button
                    key={`meal-${meal.id}`}
                    onClick={() => handleAddMeal(meal.id)}
                    className="flex items-center gap-2 w-full rounded-lg p-2 text-left hover:bg-[#FFF7ED] bg-[#FFFBF5] border border-[#FED7AA] transition-colors"
                  >
                    <span className="text-sm">{meal.icon}</span>
                    <span className="text-sm font-medium">{meal.name}</span>
                    <Badge className="text-[10px] bg-[#FED7AA] text-[#C2410C] border-0 ml-auto">
                      <UtensilsCrossed className="h-2.5 w-2.5 mr-0.5 inline" />
                      {count} varer
                    </Badge>
                  </button>
                )
              })}
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
              {searchResults.map((item: any, index: number) => (
                <button
                  key={item.id}
                  onClick={() => handleAddItem(item.id)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  className={`flex items-center gap-2 w-full rounded-lg p-2 text-left transition-colors ${
                    index === highlightIndex
                      ? 'bg-primary/10 ring-1 ring-primary/30'
                      : 'hover:bg-[#F1F5F9]'
                  }`}
                >
                  {/* Category from the section list, not from a joined field: items loaded
                      with the page carry only section_id */}
                  <span className="text-sm flex-shrink-0">{sectionMap[item.section_id]?.icon || '📦'}</span>
                  <ItemName name={item.name} className="text-sm min-w-0" />
                  {(() => {
                    const line = listItems.find((li) => li.item_id === item.id)
                    // On the list: "×1 +" (adds one) or "500 g ✎" (opens the amount picker).
                    // Ticked off: "↺" (puts it back). Few words, mostly icons.
                    if (line && !line.is_checked) {
                      const pieces = parseQuantity(line.quantity).unit === 'stk'
                      return (
                        <span
                          className="ml-auto flex items-center gap-0.5 text-[11px] font-semibold text-[#059669] bg-[#D1FAE5] rounded-full px-2 py-0.5 flex-shrink-0"
                          title={pieces ? 'På lista – legg til éin til' : 'På lista – endre mengde'}
                        >
                          {formatQuantityDisplay(line.quantity)}
                          {pieces ? <Plus className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                        </span>
                      )
                    }
                    if (line) {
                      return (
                        <span className="ml-auto flex items-center text-[#94A3B8] flex-shrink-0" title="Plukka – set tilbake på lista">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </span>
                      )
                    }
                    return sectionMap[item.section_id] ? (
                      <span className="ml-auto text-[11px] text-[#94A3B8] flex-shrink-0">{sectionMap[item.section_id].name_nn}</span>
                    ) : null
                  })()}
                  {index === highlightIndex && (
                    <span className="text-[10px] text-[#94A3B8] flex-shrink-0">↵</span>
                  )}
                  {!item.is_confirmed && (
                    <Badge className="text-[10px] bg-[#FEF3C7] text-[#D97706] border-0 ml-auto">
                      {t('list.new_badge')}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}

          {searchQuery.length > 0 && (
            <button
              onClick={() => {
                setNewItemName(searchQuery)
                setShowSectionPicker(true)
              }}
              className="mt-2 flex items-center gap-2 w-full rounded-lg p-2 text-left hover:bg-[#F1F5F9] text-primary"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t('list.create_new', 'nn', { name: searchQuery })}
              </span>
            </button>
          )}

          {/* Section picker for new items */}
          {showSectionPicker && (
            <div className="mt-2 space-y-1 border-t pt-2">
              <p className="text-xs text-[#64748B] mb-1">{t('list.pick_section')}</p>
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => handleCreateAndAdd(section.id)}
                  className="flex items-center gap-2 w-full rounded-lg p-2 text-left hover:bg-[#F1F5F9]"
                >
                  <span>{section.icon}</span>
                  <span className="text-sm">{section.name_nn}</span>
                </button>
              ))}
            </div>
          )}
          </div>
          )}

          <div className="flex items-center gap-2 rounded-xl border bg-white px-3 shadow-lg">
            <Search className="h-4 w-4 text-[#94A3B8] flex-shrink-0" />
            <Input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (searchResults.length > 0) {
                    handleAddItem(searchResults[highlightIndex]?.id || searchResults[0].id)
                  } else if (searchQuery.trim().length > 0) {
                    setNewItemName(searchQuery.trim())
                    setShowSectionPicker(true)
                  }
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlightIndex((i) => Math.min(i + 1, searchResults.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlightIndex((i) => Math.max(i - 1, 0))
                }
              }}
              placeholder={t('list.search_placeholder')}
              className="border-0 shadow-none focus-visible:ring-0 h-12 px-0 text-base"
              enterKeyHint="done"
              autoComplete="off"
              aria-label="Legg til vare"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setSearchResults([]); setMealResults([]); setShowSectionPicker(false); searchRef.current?.focus() }}
                aria-label="Tøm"
                className="p-1"
              >
                <X className="h-4 w-4 text-[#94A3B8]" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Move item section picker overlay */}
      {movingItemId && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-end justify-center" onClick={() => setMovingItemId(null)}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-4 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#0F172A]">Flytt til kategori</h3>
              <button onClick={() => setMovingItemId(null)}>
                <X className="h-5 w-5 text-[#94A3B8]" />
              </button>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {sections.map((section) => {
                const currentSection = itemsMap[movingItemId]?.section_id
                const isCurrent = section.id === currentSection
                return (
                  <button
                    key={section.id}
                    onClick={() => handleMoveItem(movingItemId, section.id)}
                    className={`flex items-center gap-2 w-full rounded-lg p-2.5 text-left transition-colors ${
                      isCurrent ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-[#F1F5F9]'
                    }`}
                  >
                    <span>{section.icon}</span>
                    <span className="text-sm">{section.name_nn}</span>
                    {isCurrent && <span className="text-[10px] text-primary ml-auto">noverande</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* List content (bottom padding keeps the last rows clear of the add bar) */}
      <div className="px-4 pt-3 pb-28">
        {loading ? (
          <p className="text-center text-[#94A3B8] py-8">Lastar...</p>
        ) : listItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#64748B] mb-3">{t('list.add_item')}</p>
            <Button onClick={() => searchRef.current?.focus()} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              {t('list.add_item')}
            </Button>
          </div>
        ) : frihandelMode ? (
          /* ── Frihandel mode: flat list sorted by smart order ── */
          <>
            {(() => {
              const smartSorted = [...uncheckedItems].sort((a, b) => {
                const itemA = itemsMap[a.item_id]
                const itemB = itemsMap[b.item_id]
                const avgA = itemA?.check_count > 0 ? itemA.check_order_sum / itemA.check_count : 999
                const avgB = itemB?.check_count > 0 ? itemB.check_order_sum / itemB.check_count : 999
                if (avgA !== avgB) return avgA - avgB
                return (itemA?.name || '').localeCompare(itemB?.name || '', 'nn')
              })
              return (
                <div className="space-y-1">
                  {smartSorted.map((li) => {
                    const item = itemsMap[li.item_id]
                    if (!item) return null
                    const section = sectionMap[item.section_id]
                    return (
                      <div
                        key={li.id}
                        className="flex items-center gap-2 rounded-lg bg-white p-3 border border-[#E2E8F0]"
                      >
                        <button
                          onClick={() => handleToggle(li.id, li.is_checked)}
                          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#E2E8F0] flex-shrink-0 hover:border-[#10B981] transition-colors"
                        />
                        <button
                          onClick={() => setMovingItemId(li.item_id)}
                          className="flex-shrink-0"
                          title={section?.name_nn || ''}
                        >
                          <span className="text-sm">{section?.icon || '📦'}</span>
                        </button>
                        <div className="flex-1 min-w-0">
                          <ItemName name={item.name} className="text-sm text-[#0F172A]" />
                          {!item.is_confirmed && (
                            <Badge className="ml-2 text-[10px] bg-[#FEF3C7] text-[#D97706] border-0">
                              {t('list.new_badge')}
                            </Badge>
                          )}
                        </div>
                        <button
                          onClick={() => setEditingQuantityId(li.id)}
                          className={`text-sm flex-shrink-0 min-w-[2rem] text-center px-2 py-1 rounded-lg border transition-colors ${
                            li.quantity === '1'
                              ? 'text-[#94A3B8] border-[#E2E8F0] hover:border-primary/40'
                              : 'bg-[#D1FAE5] text-[#059669] font-semibold border-[#A7F3D0]'
                          }`}
                        >
                          {formatQuantityDisplay(li.quantity)}
                        </button>
                        <button onClick={() => handleRemove(li.id)} className="text-[#94A3B8] hover:text-red-500 flex-shrink-0">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Checked items */}
            {checkedItems.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-4 w-4 text-[#10B981]" />
                  <span className="text-sm font-medium text-[#64748B]">
                    {t('list.done_section')} ({checkedItems.length})
                  </span>
                </div>
                <div className="space-y-1">
                  {checkedItems.map((li) => {
                    const item = itemsMap[li.item_id]
                    if (!item) return null
                    const section = sectionMap[item?.section_id]
                    return (
                      <div key={li.id} className="flex items-center gap-2 rounded-lg bg-white/50 p-3 border border-[#F1F5F9]">
                        <button
                          onClick={() => handleToggle(li.id, li.is_checked)}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-[#10B981] flex-shrink-0"
                        >
                          <Check className="h-3.5 w-3.5 text-white" />
                        </button>
                        <span className="text-sm flex-shrink-0">{section?.icon || '📦'}</span>
                        <ItemName name={item.name} className="text-sm text-[#94A3B8] line-through flex-1 min-w-0" />
                        <button onClick={() => handleRemove(li.id)} className="text-[#94A3B8] hover:text-red-500 flex-shrink-0">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── Category mode: items grouped by section ── */
          <>
            {/* Unchecked items grouped by section */}
            {sortedGroups.map(([sectionId, sectionItems]) => {
              const section = sectionMap[sectionId]
              const walkNum = walkOrderMap[sectionId]
              if (!section) return null

              // Smart sort: items checked earlier on average appear first
              const sortedItems = [...sectionItems].sort((a, b) => {
                const itemA = itemsMap[a.item_id]
                const itemB = itemsMap[b.item_id]
                const avgA = itemA?.check_count > 0 ? itemA.check_order_sum / itemA.check_count : 999
                const avgB = itemB?.check_count > 0 ? itemB.check_order_sum / itemB.check_count : 999
                if (avgA !== avgB) return avgA - avgB
                return (itemA?.name || '').localeCompare(itemB?.name || '', 'nn')
              })

              return (
                <div key={sectionId} className="mb-4">
                  <div className="flex items-center gap-2 mb-2 sticky top-[105px] bg-[#FAFAFA] py-1 z-10">
                    <span
                      className="flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: section.color }}
                    >
                      {walkNum}
                    </span>
                    <span className="text-sm">{section.icon}</span>
                    <span className="text-sm font-medium text-[#0F172A]">{section.name_nn}</span>
                  </div>
                  <div className="space-y-1">
                    {sortedItems.map((li) => {
                      const item = itemsMap[li.item_id]
                      if (!item) return null
                      return (
                        <div
                          key={li.id}
                          className="flex items-center gap-3 rounded-lg bg-white p-3 border border-[#E2E8F0]"
                        >
                          <button
                            onClick={() => handleToggle(li.id, li.is_checked)}
                            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#E2E8F0] flex-shrink-0 hover:border-[#10B981] transition-colors"
                          />
                          <div className="flex-1 min-w-0">
                            <ItemName name={item.name} className="text-sm text-[#0F172A]" />
                            {!item.is_confirmed && (
                              <Badge className="ml-2 text-[10px] bg-[#FEF3C7] text-[#D97706] border-0">
                                {t('list.new_badge')}
                              </Badge>
                            )}
                          </div>
                          <button
                            onClick={() => setMovingItemId(li.item_id)}
                            className="text-[#94A3B8] hover:text-primary flex-shrink-0"
                            title="Flytt til annan kategori"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                          onClick={() => setEditingQuantityId(li.id)}
                          className={`text-sm flex-shrink-0 min-w-[2rem] text-center px-2 py-1 rounded-lg border transition-colors ${
                            li.quantity === '1'
                              ? 'text-[#94A3B8] border-[#E2E8F0] hover:border-primary/40'
                              : 'bg-[#D1FAE5] text-[#059669] font-semibold border-[#A7F3D0]'
                          }`}
                        >
                          {formatQuantityDisplay(li.quantity)}
                        </button>
                          <button onClick={() => handleRemove(li.id)} className="text-[#94A3B8] hover:text-red-500 flex-shrink-0">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Checked items */}
            {checkedItems.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-4 w-4 text-[#10B981]" />
                  <span className="text-sm font-medium text-[#64748B]">
                    {t('list.done_section')} ({checkedItems.length})
                  </span>
                </div>
                <div className="space-y-1">
                  {checkedItems.map((li) => {
                    const item = itemsMap[li.item_id]
                    if (!item) return null
                    return (
                      <div
                        key={li.id}
                        className="flex items-center gap-3 rounded-lg bg-white/50 p-3 border border-[#F1F5F9]"
                      >
                        <button
                          onClick={() => handleToggle(li.id, li.is_checked)}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-[#10B981] flex-shrink-0"
                        >
                          <Check className="h-3.5 w-3.5 text-white" />
                        </button>
                        <ItemName name={item.name} className="text-sm text-[#94A3B8] line-through flex-1 min-w-0" />
                        <button onClick={() => handleRemove(li.id)} className="text-[#94A3B8] hover:text-red-500 flex-shrink-0">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Fullscreen next-item mode */}
      {showNextMode && (
        <NextItemMode
          items={nextModeEntries}
          onPick={(id) => handleToggle(id, false)}
          onUndo={(id) => handleToggle(id, true)}
          onClose={() => setShowNextMode(false)}
        />
      )}

      {/* Quantity picker sheet */}
      {editingQuantityId && (() => {
        const li = listItems.find((x) => x.id === editingQuantityId)
        return li ? (
          <QuantityPickerSheet
            currentQuantity={li.quantity}
            onSave={(q) => handleQuantityUpdate(li.id, q)}
            onClose={() => setEditingQuantityId(null)}
          />
        ) : null
      })()}

      {notice && (
        <div className="fixed bottom-[136px] left-1/2 -translate-x-1/2 z-50 rounded-lg bg-[#0F172A] text-white text-sm px-4 py-2 shadow-lg">
          {notice}
        </div>
      )}

    </div>
  )
}
