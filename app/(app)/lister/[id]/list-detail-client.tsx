'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { t } from '@/lib/i18n'
import { CHAIN_COLORS } from '@/lib/constants'
import { useRealtimeList } from '@/lib/hooks/use-realtime-list'
import { toggleListItem, addItemToList, removeListItem, uncheckAllItems } from '@/lib/actions/lists'
import { updateList, deleteList, saveAsTemplate } from '@/lib/actions/lists'
import { searchItems, createItem, getHouseholdItems, updateItemSection } from '@/lib/actions/items'
import { getMeals, addMealToList } from '@/lib/actions/meals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plus, Search, X, Check, Trash2, Map, Store, RotateCcw, Bookmark, MoreVertical, UtensilsCrossed, Shuffle, ArrowRightLeft } from 'lucide-react'
import type { Section, WalkOrder } from '@/lib/types'

interface Props {
  list: any
  sections: Section[]
  walkOrder: WalkOrder[]
  householdStores: any[]
}

export function ListDetailClient({ list, sections, walkOrder, householdStores }: Props) {
  const router = useRouter()
  const { items: listItems, loading, optimisticToggle, optimisticRemove } = useRealtimeList(list.id)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
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
  const searchRef = useRef<HTMLInputElement>(null)
  const [itemsMap, setItemsMap] = useState<Record<string, any>>({})

  // Fetch item details and meals
  useEffect(() => {
    async function fetchItemDetails() {
      if (listItems.length === 0) return
      const results = await getHouseholdItems()
      const map: Record<string, any> = {}
      for (const item of results) {
        map[item.id] = item
      }
      setItemsMap(map)
    }
    fetchItemDetails()
  }, [listItems.length])

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

  // Search handler
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
    if (query.length < 1) {
      setSearchResults([])
      setMealResults([])
      return
    }
    const results = await searchItems(query)
    const existingItemIds = new Set(listItems.map((li) => li.item_id))
    setSearchResults(results.filter((r: any) => !existingItemIds.has(r.id)))
    // Filter meals matching query
    const lq = query.toLowerCase()
    setMealResults(meals.filter((m) => m.name.toLowerCase().includes(lq)))
    setHighlightIndex(0)
  }, [listItems, meals])

  async function handleAddItem(itemId: string) {
    await addItemToList(list.id, itemId)
    setSearchQuery('')
    setSearchResults([])
    // Keep search open and refocus for quick consecutive adds
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  async function handleCreateAndAdd(sectionId: string) {
    const result = await createItem(newItemName, sectionId)
    if (result.item) {
      await addItemToList(list.id, result.item.id)
      // Add the new item to the local items map immediately
      setItemsMap((prev) => ({ ...prev, [result.item.id]: { ...result.item, sections: sections.find((s) => s.id === sectionId) } }))
    }
    setNewItemName('')
    setShowSectionPicker(false)
    setSearchQuery('')
    setSearchResults([])
    // Keep search open and refocus for quick consecutive adds
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  async function handleAddMeal(mealId: string) {
    await addMealToList(mealId, list.id)
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

  async function handleToggle(listItemId: string, currentChecked: boolean) {
    // Optimistic update: immediately reflect in UI
    optimisticToggle(listItemId, !currentChecked)
    await toggleListItem(listItemId, !currentChecked)
  }

  async function handleRemove(listItemId: string) {
    // Optimistic update: immediately remove from UI
    optimisticRemove(listItemId)
    await removeListItem(listItemId)
  }

  async function handleStoreChange(storeId: string) {
    await updateList(list.id, { store_id: storeId })
    setShowStoreSelector(false)
    router.refresh()
  }

  async function handleUncheckAll() {
    await uncheckAllItems(list.id)
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
            {list.stores && list.store_id && (
              <Link href={`/butikkar/${list.store_id}/kart`} className="text-[#64748B]">
                <Map className="h-5 w-5" />
              </Link>
            )}
            <button onClick={() => setShowSearch(true)} className="text-[#64748B]">
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

      {/* Search overlay */}
      {showSearch && (
        <div className="border-b bg-white px-4 py-3">
          <div className="flex items-center gap-2">
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
              className="border-0 shadow-none focus-visible:ring-0 h-8"
              autoFocus
            />
            <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); setMealResults([]) }}>
              <X className="h-4 w-4 text-[#94A3B8]" />
            </button>
          </div>

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
                  <span className="text-sm">{item.sections?.icon}</span>
                  <span className="text-sm">{item.name}</span>
                  {index === highlightIndex && (
                    <span className="text-[10px] text-[#94A3B8] ml-auto">↵</span>
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

      {/* List content */}
      <div className="px-4 py-3">
        {loading ? (
          <p className="text-center text-[#94A3B8] py-8">Lastar...</p>
        ) : listItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#64748B] mb-3">{t('list.add_item')}</p>
            <Button onClick={() => setShowSearch(true)} variant="outline">
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
                          <span className="text-sm text-[#0F172A]">{item.name}</span>
                          {!item.is_confirmed && (
                            <Badge className="ml-2 text-[10px] bg-[#FEF3C7] text-[#D97706] border-0">
                              {t('list.new_badge')}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-[#94A3B8] flex-shrink-0">{li.quantity}</span>
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
                        <span className="text-sm text-[#94A3B8] line-through flex-1">{item.name}</span>
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
                            <span className="text-sm text-[#0F172A]">{item.name}</span>
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
                          <span className="text-xs text-[#94A3B8] flex-shrink-0">{li.quantity}</span>
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
                        <span className="text-sm text-[#94A3B8] line-through flex-1">{item.name}</span>
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

      {/* Bottom actions */}
      <div className="fixed bottom-20 right-4 z-30">
        <Button
          onClick={() => setShowSearch(true)}
          className="rounded-full h-14 w-14 shadow-lg"
          size="icon"
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>
    </div>
  )
}
