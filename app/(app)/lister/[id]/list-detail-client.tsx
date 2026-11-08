'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useNearbyStore, type StorePoint } from '@/lib/hooks/use-nearby-store'
import { useKeyboardViewport } from '@/lib/hooks/use-keyboard-viewport'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { t } from '@/lib/i18n'
import { CHAIN_COLORS } from '@/lib/constants'
import { useRealtimeList } from '@/lib/hooks/use-realtime-list'
import { updateList, deleteList, saveAsTemplate } from '@/lib/actions/lists'
import { getHouseholdItems, updateItemSection } from '@/lib/actions/items'
import { createMeal } from '@/lib/actions/meals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { QuantityPickerSheet, formatQuantityDisplay, parseQuantity } from '@/components/quantity-picker-sheet'
import { NextItemMode, type NextItemEntry } from '@/components/next-item-mode'
import { ItemName } from '@/components/item-name'
import { ListMealsSheet } from '@/components/list-meals-sheet'
import { useOutbox, type OutboxOp } from '@/lib/hooks/use-outbox'
import { type BatchLine } from '@/lib/list-outbox'
import { overlayListContents } from '@/lib/list-meals'
import { applyListWrite } from '@/lib/actions/list-writes'
import { searchAll, resolveName, guessSection, displayName, type KnownItem } from '@/lib/match'
import { parseEntry, splitEntries, isMultiEntry } from '@/lib/parse-list'
import { scaleQty, addQty } from '@/lib/quantity'
import type { CatalogProduct } from '@/lib/catalog-data'
import { ArrowLeft, Plus, Search, X, Check, Trash2, Store, RotateCcw, Bookmark, MoreVertical, UtensilsCrossed, ListChecks, Shuffle, ArrowRightLeft, Play, Pencil, CloudOff, History, MapPin, Users } from 'lucide-react'
import type { Section, WalkOrder, ListItem, ListMeal, MealSource } from '@/lib/types'

interface Props {
  list: any
  sections: Section[]
  walkOrder: WalkOrder[]
  householdStores: any[]
  initialItems: any[]
  initialMeals: any[]
  initialLines: ListItem[]
  initialListMeals?: ListMeal[]
  householdSize: number | null   // dinner portions (adults + ½ × children)
  householdLabel: string         // "2 vaksne + 3 born"
  itemRoutes: Record<string, { avg: number; n: number }>     // this household, this shop
  sectionRoutes: Record<string, { avg: number; n: number }>  // all households, this shop
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
}

export function ListDetailClient({ list, sections, walkOrder, householdStores, initialItems, initialMeals, initialLines, initialListMeals = [], householdSize, householdLabel, itemRoutes, sectionRoutes }: Props) {
  const router = useRouter()
  const { items: serverItems, meals: savedListMeals, loading, refetch, notifyChanged, acceptWrite } = useRealtimeList(list.id, initialLines, initialListMeals)
  const outbox = useOutbox(list.id, write => applyListWrite(list.id, write), (_write, result) => {
    acceptWrite(result)
    setItemsMap(prev => {
      const next = { ...prev }
      for (const [oldId, newId] of Object.entries(result.aliases ?? {})) if (oldId !== newId) delete next[oldId]
      for (const item of result.items ?? []) next[item.id] = item
      return next
    })
    notifyChanged()
  }, () => { void refetch(); notifyChanged() })
  const { lines: listItems, meals: listMeals } = overlayListContents(serverItems, savedListMeals, outbox.pending, list.id)
  const [showMeals, setShowMeals] = useState(false)
  const [showPicked, setShowPicked] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const busyCopy = outbox.pending.some(w => w.op.kind === 'copy')
  const keyboardArea = useKeyboardViewport()
  const [portionPicker, setPortionPicker] = useState<{ mealId: string; name: string; icon: string; portions: number } | null>(null)
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
  const meals = initialMeals
  const [mealResults, setMealResults] = useState<any[]>([])
  const [movingItemId, setMovingItemId] = useState<string | null>(null)
  // View mode starts automatic: route order once this shop's route is learned for most
  // of the list, by section before that. Tapping the toggle overrides it.
  const learnedShare = (() => {
    const open = initialLines.filter((l) => !l.is_checked)
    if (open.length === 0) return 0
    return open.filter((l) => (itemRoutes[l.item_id]?.n ?? 0) >= 2).length / open.length
  })()
  const [frihandelMode, setFrihandelModeRaw] = useState(learnedShare >= 0.5)
  const modeChosenByUser = useRef(false)
  const setFrihandelMode = (v: boolean) => { modeChosenByUser.current = true; setFrihandelModeRaw(v) }
  useEffect(() => {
    // Shop changed (GPS or by hand): re-pick the automatic mode unless the user chose
    if (!modeChosenByUser.current) setFrihandelModeRaw(learnedShare >= 0.5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.store_id])
  const [editingQuantityId, setEditingQuantityId] = useState<string | null>(null)
  const [showNextMode, setShowNextMode] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [storedItems, setItemsMap] = useState<Record<string, any>>(() => {
    const map: Record<string, any> = {}
    for (const item of initialItems) map[item.id] = item
    return map
  })

  const skipMetadataSave = useRef(true)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`handleliste-items-${list.id}`) || 'null')
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) setItemsMap(prev => ({ ...saved, ...prev }))
    } catch {}
  }, [list.id])
  useEffect(() => {
    if (skipMetadataSave.current) { skipMetadataSave.current = false; return }
    try { localStorage.setItem(`handleliste-items-${list.id}`, JSON.stringify(storedItems)) } catch {}
  }, [storedItems, list.id])
  const itemsMap = { ...storedItems }
  for (const { op } of outbox.pending) {
    const snapshots = op.kind === 'batch' ? op.lines : (op.kind === 'add' || op.kind === 'create') ? [op] : []
    for (const item of snapshots) if (item.name && !itemsMap[item.itemId]) itemsMap[item.itemId] = {
      id: item.itemId, name: item.name, section_id: item.sectionId, times_purchased: 0, is_confirmed: true,
    }
  }

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
    }).catch(() => {})
  }, [unknownItem])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(t)
  }, [notice])


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

  // ── Order in the shop ─────────────────────────────────────────────────────────
  // Relative comparisons become stable display ranks, best source first:
  //   item route in this shop (learned from observed pick order)
  //   → section route in this shop (learned, shared between households)
  //   → the shop's section layout (set by hand under Butikkar)
  //   → alphabetical order for products without observations
  const maxWalk = Math.max(1, ...walkOrder.map((w) => w.walk_order))
  const sectionPos = (sectionId: string | null | undefined): number => {
    if (!sectionId) return 1
    const learned = sectionRoutes[sectionId]
    if (learned && learned.n >= 2) return learned.avg
    const w = walkOrderMap[sectionId]
    return w != null ? w / maxWalk : 1
  }
  const itemPos = (li: { item_id: string }): number => {
    const r = itemRoutes[li.item_id]
    if (r) return r.avg
    const it = itemsMap[li.item_id]
    return sectionPos(it?.section_id) + 0.0001 // just after learned items of the section
  }
  const inSectionPos = (li: { item_id: string }): number => {
    const r = itemRoutes[li.item_id]
    if (r) return r.avg
    return 3 // Unknown products keep name order; old absolute tick positions are no longer used.
  }
  const byName = (a: { item_id: string }, b: { item_id: string }) =>
    (itemsMap[a.item_id]?.name || '').localeCompare(itemsMap[b.item_id]?.name || '', 'nn')
  const byRoute = (a: { item_id: string }, b: { item_id: string }) => itemPos(a) - itemPos(b) || byName(a, b)
  const byRouteInSection = (a: { item_id: string }, b: { item_id: string }) => inSectionPos(a) - inSectionPos(b) || byName(a, b)

  const sortedGroups = Object.entries(groupedItems)
    .sort(([a], [b]) => sectionPos(a === 'unknown' ? null : a) - sectionPos(b === 'unknown' ? null : b))

  // Walking order for "next item" mode: same order the current view shows
  const routeItems = frihandelMode
    ? [...uncheckedItems].sort(byRoute)
    : sortedGroups.flatMap(([, group]) => [...group].sort(byRouteInSection))
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

  const sectionIdByName: Record<string, string> = {}
  sections.forEach((s) => { sectionIdByName[s.name_nn] = s.id })
  const fallbackSectionId = sectionIdByName['Tørrvarer'] ?? sections[0]?.id

  // Search runs on the phone over the household's items plus the product catalogue:
  // no network, so results are always current when Enter is pressed. Catalogue hits
  // get a "cat:" id and become household items the first time they are added.
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query)
    setShowSectionPicker(false)
    // For "2 kg potet" search on the name part only
    const term = parseEntry(splitEntries(query).pop() ?? query).name
    if (query.trim().length < 1 || !term) {
      setSearchResults([])
      setMealResults([])
      return
    }
    // Items already on the list stay in the results, marked with their quantity, so
    // picking one again adds to the quantity instead of silently doing nothing
    const hits = searchAll(Object.values(itemsMap) as KnownItem[], term)
    setSearchResults(hits.map((h) =>
      h.kind === 'item'
        ? h.item
        : { id: `cat:${h.product.name}`, name: h.product.name, section_id: sectionIdByName[h.product.section] ?? null, is_confirmed: true, catalog: h.product },
    ))
    const lq = term.toLowerCase()
    const own = meals.filter((m) => m.name.toLowerCase().includes(lq))
    setMealResults(own)
    setHighlightIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listItems, meals, itemsMap, sections])

  function resetSearch() {
    setSearchQuery('')
    setSearchResults([])
    setMealResults([])
    // Keep search open and focused for quick consecutive adds
    searchRef.current?.focus()
  }

  /** A catalogue product picked for the first time: make it a household item and add it. */
  function addFromCatalog(product: CatalogProduct, quantity?: string) {
    resetSearch()
    const sectionId = sectionIdByName[product.section] ?? fallbackSectionId
    const itemId = newId()
    const clientId = newId()
    const qty = quantity && quantity !== '1' ? quantity : product.qty ?? '1'
    setItemsMap((prev) => ({
      ...prev,
      [itemId]: { id: itemId, name: product.name, section_id: sectionId, times_purchased: 0, is_confirmed: true, check_count: 0, check_order_sum: 0 },
    }))
    send({ kind: 'create', clientId, itemId, name: product.name, sectionId, quantity: qty, confirmed: true })
  }

  /**
   * Several entries at once ("mjølk, 2 kg potet, 3 egg") or one with an amount
   * ("2 kg potet"). Each is matched to a household item, a catalogue product or a new
   * item (section guessed from catalogue words; the "Ny" badge lets you move it).
   */
  async function handleMultiAdd(text: string) {
    resetSearch()
    const lines: { itemId: string; quantity: string; create?: { name: string; sectionId: string } }[] = []
    const newItems: Record<string, any> = {}
    const known = Object.values(itemsMap) as KnownItem[]
    for (const entry of splitEntries(text)) {
      const { name, quantity } = parseEntry(entry)
      if (!name) continue
      const hit = resolveName(known, name)
      if (hit?.kind === 'item') {
        lines.push({ itemId: hit.item.id, quantity })
      } else if (hit?.kind === 'catalog') {
        const id = newId()
        const sectionId = sectionIdByName[hit.product.section] ?? fallbackSectionId
        lines.push({ itemId: id, quantity: quantity !== '1' ? quantity : hit.product.qty ?? '1', create: { name: hit.product.name, sectionId } })
        newItems[id] = { id, name: hit.product.name, section_id: sectionId, times_purchased: 0, is_confirmed: true }
      } else {
        const id = newId()
        const guessed = guessSection(name)
        const sectionId = (guessed && sectionIdByName[guessed]) || fallbackSectionId
        lines.push({ itemId: id, quantity, create: { name: displayName(name), sectionId } })
        newItems[id] = { id, name: displayName(name), section_id: sectionId, times_purchased: 0, is_confirmed: false }
      }
      const last = lines[lines.length - 1]
      if (last?.create) known.push({ id: last.itemId, name: last.create.name, section_id: last.create.sectionId })
    }
    if (!lines.length) return
    setItemsMap((prev) => ({ ...prev, ...newItems }))
    queueBatch(lines)
  }

  function handleAddItem(itemId: string) {
    if (itemId.startsWith('cat:')) {
      const product = searchResults.find((r: any) => r.id === itemId)?.catalog as CatalogProduct | undefined
      if (product) addFromCatalog(product, parseEntry(searchQuery).quantity)
      return
    }
    // "2 kg kjøtdeig" typed, then a hit tapped: keep the typed amount
    const typedQty = parseEntry(searchQuery).quantity
    resetSearch()

    const name = itemsMap[itemId]?.name || 'Vara'

    // Already on the list and not ticked: add one more (pieces), or open the amount
    // picker when it is measured in g, L etc., where "one more" has no obvious meaning
    const active = listItems.find((li) => li.item_id === itemId && !li.is_checked)
    if (active) {
      const { amount, unit } = parseQuantity(active.quantity)
      if (typedQty !== '1' && addQty(active.quantity, typedQty)) {
        queueBatch([{ itemId, quantity: typedQty }])
      } else if (unit === 'stk' && typedQty === '1') {
        queueBatch([{ itemId, quantity: '1' }])
        setNotice(`${name}: ×${amount + 1}`)
      } else {
        setEditingQuantityId(active.id)
      }
      return
    }

    // Already on the list but ticked off: untick it
    const ticked = listItems.find((li) => li.item_id === itemId && li.is_checked)
    if (ticked) {
      send({ kind: 'add', clientId: newId(), itemId, quantity: typedQty === '1' ? ticked.quantity : typedQty })
      setNotice(`${name} er tilbake på lista`)
      return
    }

    // Show the line now, store it in the background (or queue it if there is no signal)
    const clientId = newId()
    send({ kind: 'add', clientId, itemId, quantity: typedQty })
  }

  function send(op: OutboxOp) {
    if (op.kind === 'add') op = { ...op, name: itemsMap[op.itemId]?.name, sectionId: itemsMap[op.itemId]?.section_id }
    outbox.enqueue(op)
  }

  function queueBatch(lines: { itemId: string; quantity: string; create?: { name: string; sectionId: string } }[], meal?: MealSource) {
    if (!lines.length) return
    const quantities = new globalThis.Map(listItems.map(l => [l.item_id, l.is_checked ? null : l.quantity]))
    const batch: BatchLine[] = lines.map(l => {
      const previous = quantities.get(l.itemId)
      const optimisticQuantity = previous ? addQty(previous, l.quantity) ?? previous : l.quantity
      quantities.set(l.itemId, optimisticQuantity)
      return { clientId: newId(), itemId: l.itemId, quantity: l.quantity, optimisticQuantity,
        name: l.create?.name ?? itemsMap[l.itemId]?.name,
        sectionId: l.create?.sectionId ?? itemsMap[l.itemId]?.section_id,
        ...(l.create ? { create: true, confirmed: true } : {}),
      }
    })
    send({ kind: 'batch', lines: batch, ...(meal ? { meal } : {}) })
  }

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
    send({ kind: 'create', clientId, itemId, name, sectionId })
  }

  async function handleAddMeal(mealId: string, people?: number) {
    setPortionPicker(null)
    const meal = meals.find((m) => m.id === mealId)
    resetSearch()
    if (!meal?.ingredients) { setNotice('Opne lista på nett ein gong for å lagre middagen på telefonen'); return }
    const target = people ?? householdSize
    const base = meal.servings ?? (people ? householdSize : null)
    const factor = target && base ? target / base : 1
    queueBatch(meal.ingredients.map((ingredient: any) => ({ itemId: ingredient.item_id, quantity: scaleQty(ingredient.quantity, factor) })),
      { id: newId(), mealId: meal.id, name: meal.name, icon: meal.icon, servings: target ?? meal.servings ?? null })
  }

  /** New dinner named after what was typed; fill it in, then it is added back here. */
  async function handleCreateMealFromSearch() {
    const name = displayName(searchQuery.trim())
    if (!name) return
    const r: any = await createMeal(name, '🍽️')
    if (r?.meal) router.push(`/middagar/${r.meal.id}?tilListe=${list.id}`)
    else setNotice(r?.error || 'Kunne ikkje lage middag')
  }

  /** "Same as last time": copy the previous list's lines into this one. */
  async function handleCopyPrevious() {
    setShowMenu(false)
    if (!busyCopy) send({ kind: 'copy' })
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
    // Don't let ticks made far from any shop (at home) teach the route
    send({ kind: 'toggle', listItemId, checked: !currentChecked, record: geo.status !== 'away', pickedAt: new Date().toISOString() })
  }

  function handleQuantityUpdate(listItemId: string, quantity: string) {
    setEditingQuantityId(null)
    send({ kind: 'qty', listItemId, quantity })
  }

  function handleRemove(listItemId: string) {
    send({ kind: 'remove', listItemId })
  }

  async function handleStoreChange(storeId: string, auto = false) {
    if (outbox.waiting) { setNotice('Vent til endringane er lagra før du byter butikk'); return }
    if (!auto) storeChosenByHand.current = true
    setShowStoreSelector(false)
    if (storeId === list.store_id) return
    await updateList(list.id, { store_id: storeId })
    router.refresh() // reloads this shop's layout and learned route
  }

  // ── Which shop am I in? ───────────────────────────────────────────────────────
  const storePoints = useMemo(
    () => householdStores.map((hs: any) => hs.stores).filter(Boolean) as StorePoint[],
    [householdStores],
  )
  const { geo, locate } = useNearbyStore(storePoints)
  const storeChosenByHand = useRef(false)
  const storeName = (id: string) => storePoints.find((s) => s.id === id)?.name ?? 'butikken'

  useEffect(() => {
    if (geo.status === 'at' && geo.storeId !== list.store_id && !storeChosenByHand.current) {
      handleStoreChange(geo.storeId, true)
      setNotice(`📍 ${storeName(geo.storeId)} – sortert etter ruta di der`)
    } else if (geo.status === 'between') {
      setShowStoreSelector(true)
      setNotice('📍 Kva butikk er du i?')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo])

  async function handleUncheckAll() {
    send({ kind: 'uncheck' })
    setShowMenu(false)
  }

  function handleClearList() {
    setShowMenu(false)
    if ((!listItems.length && !listMeals.length) || busyCopy) return
    if (!confirm('Tømme lista? Alle varene blir fjerna, også dei som er plukka. Sjølve lista blir ståande.')) return
    // Persist every removal together, then reuse the retry-safe online/offline queue.
    // Target this snapshot so another phone's later additions are not removed.
    outbox.enqueueMany([
      ...listItems.map(li => ({ kind: 'remove' as const, listItemId: li.id })),
      ...listMeals.map(meal => ({ kind: 'mealRemove' as const, mealId: meal.id })),
    ])
    setShowPicked(false)
  }

  function handleRemoveMeal(mealId: string, itemId?: string) {
    const meal = listMeals.find(m => m.id === mealId)
    if (!meal) return
    if (!itemId && !confirm(`Fjerne «${meal.name}» og mengdene til denne retten frå lista?`)) return
    send({kind:'mealRemove',mealId,...(itemId ? {itemId} : {})})
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) return
    if (outbox.waiting) { setNotice('Vent til endringane er lagra før du lagrar malen'); return }
    await saveAsTemplate(list.id, templateName.trim())
    setTemplateName('')
    setShowTemplateSave(false)
    setShowMenu(false)
  }

  async function handleDeleteList() {
    if (outbox.waiting) { setNotice('Vent til endringane er lagra før du slettar lista'); return }
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
      <div className="sticky top-12 z-40 bg-white border-b px-4 py-3">
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
            <div className="relative">
              <button onClick={() => setShowMenu(!showMenu)} className="text-[#64748B]" aria-label="Listeval" aria-expanded={showMenu}>
                <MoreVertical className="h-5 w-5" />
              </button>
              {showMenu && (
                <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border py-1 w-56 z-50">
                  <button
                    onClick={handleCopyPrevious}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-[#F1F5F9]"
                  >
                    <History className="h-4 w-4 text-[#64748B]" />
                    Same som sist
                  </button>
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
                  {(totalItems > 0 || listMeals.length > 0) && (
                    <button
                      onClick={handleClearList}
                      disabled={busyCopy}
                      className="flex items-center gap-2 w-full min-h-11 px-3 py-2 text-sm text-left hover:bg-[#F1F5F9] text-red-600 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                      Tøm liste
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
            className="min-w-0 truncate text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: chainColor?.lightBg || '#F1F5F9',
              color: chainColor?.primary || '#64748B',
            }}
          >
            {list.stores?.name || t('lists.no_store')} · {t('list.switch_store')}
          </button>
          {/* 📍 finds the shop you're in. Green: in a known shop. Grey: not asked yet,
              or far away (ticks at home don't teach the route). */}
          <button
            onClick={() => { storeChosenByHand.current = false; locate() }}
            className={`flex items-center gap-0.5 text-xs rounded-full px-1.5 py-0.5 ${
              geo.status === 'at' ? 'text-[#059669] bg-[#D1FAE5]' : geo.status === 'denied' ? 'text-red-500' : 'text-[#64748B] bg-[#F1F5F9]'
            }`}
            title={
              geo.status === 'at' ? `Du er i ${storeName(geo.storeId)}`
              : geo.status === 'away' ? 'Ikkje i nærleiken av ein butikk'
              : geo.status === 'denied' ? 'Posisjon er ikkje tillaten i nettlesaren'
              : 'Finn butikken eg er i'
            }
            aria-label="Finn butikken eg er i"
          >
            <MapPin className={`h-3.5 w-3.5 ${geo.status === 'locating' ? 'animate-pulse' : ''}`} />
            {geo.status === 'away' && <span>heime?</span>}
          </button>
          <button type="button" onClick={() => setShowMeals(!showMeals)} aria-haspopup="dialog" aria-expanded={showMeals}
            className="flex min-h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs font-medium text-[#475569]">
            <ListChecks className="h-4 w-4" />Middagar i lista ({listMeals.length})
          </button>
          {outbox.waiting > 0 && (
            <span
              className="flex items-center gap-1 text-[11px] font-medium text-[#B45309] bg-[#FEF3C7] rounded-full px-2 py-0.5"
              title="Endringar som ventar på lagring"
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

      {showMeals && <ListMealsSheet meals={listMeals} listName={list.name} onClose={() => setShowMeals(false)} onRemove={handleRemoveMeal} />}

      {outbox.error && (
        <div role="alert" className="mx-4 my-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>{outbox.error}</p>
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={outbox.retry} className="min-h-11 underline">Prøv igjen</button>
            <button type="button" onClick={() => { if (confirm('Forkaste venta endringar og hente lista på nytt?')) outbox.discard() }} className="min-h-11 underline">Forkast venta endringar</button>
          </div>
        </div>
      )}

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

      {/* Add bar stays above the keyboard; suggestions require typed input. */}
      {/* With the keyboard up, pin the bar to the bottom of the visible area (just above
          the keyboard) and let the results use only the height that is actually visible */}
      {!showNextMode && <div
        className={`fixed left-0 right-0 z-40 pointer-events-none ${keyboardArea ? 'pb-1' : 'bottom-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]'}`}
        style={keyboardArea ? { top: keyboardArea.top + keyboardArea.height, transform: 'translateY(-100%)' } : undefined}
      >
        <div className="mx-auto max-w-lg px-3 pointer-events-auto">
          {(searchQuery.trim().length > 0 || showSectionPicker) && (
          <div
            className="mb-1 max-h-[45vh] overflow-y-auto overscroll-contain rounded-xl border bg-white px-3 py-2 shadow-lg"
            style={keyboardArea ? { maxHeight: Math.max(120, keyboardArea.height - 72) } : undefined}
          >

          {/* Meal results */}
          {mealResults.length > 0 && (
            <div className="mt-2 space-y-1">
              {mealResults.map((meal: any) => {
                const count = meal.meal_items?.[0]?.count || 0
                return (
                  <div key={`meal-${meal.id}`} className="flex items-stretch gap-1">
                    {/* Tap: add, scaled to the household. 👥: pick another number of portions first */}
                    <button
                      onClick={() => handleAddMeal(meal.id)}
                      className="flex flex-1 min-w-0 items-center gap-2 rounded-lg p-2 text-left hover:bg-[#FFF7ED] bg-[#FFFBF5] border border-[#FED7AA] transition-colors"
                    >
                      <span className="text-sm">{meal.icon}</span>
                      <span className="text-sm font-medium truncate">{meal.name}</span>
                      <Badge className="text-[10px] bg-[#FED7AA] text-[#C2410C] border-0 ml-auto flex-shrink-0">
                        <UtensilsCrossed className="h-2.5 w-2.5 mr-0.5 inline" />
                        {count} varer
                      </Badge>
                    </button>
                    <button
                      onClick={() => setPortionPicker({ mealId: meal.id, name: meal.name, icon: meal.icon, portions: householdSize ?? 4 })}
                      className="flex items-center gap-0.5 rounded-lg border border-[#FED7AA] bg-white px-2 text-[11px] text-[#C2410C]"
                      aria-label={`Vel tal porsjonar for ${meal.name}`}
                      title="Vel tal porsjonar"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {householdSize ?? ''}
                    </button>
                  </div>
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

          {/* …or make it a new dinner: opens the dinner to fill in, then back here */}
          {searchQuery.trim().length > 1 && !isMultiEntry(searchQuery) && (
            <button
              onClick={handleCreateMealFromSearch}
              className="flex items-center gap-2 w-full rounded-lg p-2 text-left hover:bg-[#FFF7ED] text-[#C2410C]"
            >
              <UtensilsCrossed className="h-4 w-4" />
              <span className="text-sm font-medium">Lag middag «{displayName(searchQuery.trim())}»</span>
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
              type="search"
              name="shopping-item-search"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  // Several entries, or one with an amount: add them all in one go
                  if (isMultiEntry(searchQuery) || (parseEntry(searchQuery).quantity !== '1' && searchResults.length === 0)) {
                    handleMultiAdd(searchQuery)
                  } else if (searchResults.length > 0) {
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
              className="border-0 shadow-none focus-visible:ring-0 h-12 px-0 text-base [&::-webkit-search-cancel-button]:appearance-none"
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
      </div>}

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
          <div className="text-center py-10 space-y-4">
            <p className="text-[#64748B]">Lista er tom</p>
            <Button onClick={handleCopyPrevious} disabled={busyCopy} className="h-12 px-6">
              <History className="h-4 w-4 mr-2" />
              {busyCopy ? 'Hentar…' : 'Same som sist'}
            </Button>

          </div>
        ) : frihandelMode ? (
          /* ── Frihandel mode: flat list sorted by smart order ── */
          <>
            {(() => {
              const smartSorted = [...uncheckedItems].sort(byRoute)
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
                <button type="button" onClick={() => setShowPicked(!showPicked)} aria-expanded={showPicked} className="flex items-center gap-2 mb-2 min-h-11">
                  <Check className="h-4 w-4 text-[#10B981]" />
                  <span className="text-sm font-medium text-[#64748B]">
                    {t('list.done_section')} ({checkedItems.length}) {showPicked ? '▾' : '▸'}
                  </span>
                </button>
                <div className="space-y-1" hidden={!showPicked}>
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

              // Within a section: relative route in this shop, then name order
              const sortedItems = [...sectionItems].sort(byRouteInSection)

              return (
                <div key={sectionId} className="mb-4">
                  <div className="flex items-center gap-2 mb-2 sticky top-[153px] bg-[#FAFAFA] py-1 z-10">
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
                <button type="button" onClick={() => setShowPicked(!showPicked)} aria-expanded={showPicked} className="flex items-center gap-2 mb-2 min-h-11">
                  <Check className="h-4 w-4 text-[#10B981]" />
                  <span className="text-sm font-medium text-[#64748B]">
                    {t('list.done_section')} ({checkedItems.length}) {showPicked ? '▾' : '▸'}
                  </span>
                </button>
                <div className="space-y-1" hidden={!showPicked}>
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

      {/* Portions override for one meal */}
      {portionPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setPortionPicker(null)}>
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 pb-8 space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-[#0F172A]">{portionPicker.icon} {portionPicker.name}</p>
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={() => setPortionPicker((p) => p && { ...p, portions: Math.max(0.5, p.portions - 0.5) })}
                className="h-12 w-12 rounded-full border text-2xl text-[#64748B]"
                aria-label="Færre porsjonar"
              >−</button>
              <div className="text-center">
                <p className="text-3xl font-bold text-[#0F172A]">{String(portionPicker.portions).replace('.', ',')}</p>
                <p className="text-xs text-[#94A3B8]">porsjonar</p>
              </div>
              <button
                onClick={() => setPortionPicker((p) => p && { ...p, portions: Math.min(40, p.portions + 0.5) })}
                className="h-12 w-12 rounded-full border text-2xl text-[#64748B]"
                aria-label="Fleire porsjonar"
              >+</button>
            </div>
            <p className="text-center text-xs text-[#94A3B8]">Husstanden: {householdLabel || 'ukjend'} = {String(householdSize ?? '–').replace('.', ',')} porsjonar</p>
            <Button className="w-full h-12" onClick={() => handleAddMeal(portionPicker.mealId, portionPicker.portions)}>
              Legg i lista
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-50 rounded-lg bg-[#0F172A] text-white text-sm px-4 py-2 shadow-lg">
          {notice}
        </div>
      )}

    </div>
  )
}
