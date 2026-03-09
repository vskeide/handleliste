'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { t } from '@/lib/i18n'
import { CHAIN_COLORS } from '@/lib/constants'
import { useRealtimeList } from '@/lib/hooks/use-realtime-list'
import { toggleListItem, addItemToList, removeListItem, updateListItemQuantity } from '@/lib/actions/lists'
import { updateList, deleteList } from '@/lib/actions/lists'
import { searchItems, createItem } from '@/lib/actions/items'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plus, Search, X, Check, Trash2, Map, Store } from 'lucide-react'
import type { Section, WalkOrder } from '@/lib/types'

interface Props {
  list: any
  sections: Section[]
  walkOrder: WalkOrder[]
  householdStores: any[]
}

export function ListDetailClient({ list, sections, walkOrder, householdStores }: Props) {
  const router = useRouter()
  const { items: listItems, loading } = useRealtimeList(list.id)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [showStoreSelector, setShowStoreSelector] = useState(false)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [itemsMap, setItemsMap] = useState<Record<string, any>>({})

  // Fetch item details for list items
  useEffect(() => {
    async function fetchItemDetails() {
      if (listItems.length === 0) return
      const itemIds = listItems.map((li) => li.item_id)
      const results = await searchItems('')
      const map: Record<string, any> = {}
      for (const item of results) {
        map[item.id] = item
      }
      setItemsMap(map)
    }
    fetchItemDetails()
  }, [listItems.length])

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
      return
    }
    const results = await searchItems(query)
    // Filter out items already on the list
    const existingItemIds = new Set(listItems.map((li) => li.item_id))
    setSearchResults(results.filter((r: any) => !existingItemIds.has(r.id)))
  }, [listItems])

  async function handleAddItem(itemId: string) {
    await addItemToList(list.id, itemId)
    setSearchQuery('')
    setSearchResults([])
    setShowSearch(false)
  }

  async function handleCreateAndAdd(sectionId: string) {
    const result = await createItem(newItemName, sectionId)
    if (result.item) {
      await addItemToList(list.id, result.item.id)
    }
    setNewItemName('')
    setShowSectionPicker(false)
    setShowSearch(false)
    setSearchQuery('')
  }

  async function handleToggle(listItemId: string, currentChecked: boolean) {
    await toggleListItem(listItemId, !currentChecked)
  }

  async function handleRemove(listItemId: string) {
    await removeListItem(listItemId)
  }

  async function handleStoreChange(storeId: string) {
    await updateList(list.id, { store_id: storeId })
    setShowStoreSelector(false)
    router.refresh()
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
            {list.stores && list.store_id && (
              <Link href={`/butikkar/${list.store_id}/kart`} className="text-[#64748B]">
                <Map className="h-5 w-5" />
              </Link>
            )}
            <button onClick={() => setShowSearch(true)} className="text-[#64748B]">
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>

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
        <div className="border-b bg-white px-4 py-3 space-y-2">
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
              placeholder={t('list.search_placeholder')}
              className="border-0 shadow-none focus-visible:ring-0 h-8"
              autoFocus
            />
            <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]) }}>
              <X className="h-4 w-4 text-[#94A3B8]" />
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
              {searchResults.map((item: any) => (
                <button
                  key={item.id}
                  onClick={() => handleAddItem(item.id)}
                  className="flex items-center gap-2 w-full rounded-lg p-2 text-left hover:bg-[#F1F5F9]"
                >
                  <span className="text-sm">{item.sections?.icon}</span>
                  <span className="text-sm">{item.name}</span>
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
        ) : (
          <>
            {/* Unchecked items grouped by section */}
            {sortedGroups.map(([sectionId, sectionItems]) => {
              const section = sectionMap[sectionId]
              const walkNum = walkOrderMap[sectionId]
              if (!section) return null

              const sortedItems = [...sectionItems].sort((a, b) => {
                const nameA = itemsMap[a.item_id]?.name || ''
                const nameB = itemsMap[b.item_id]?.name || ''
                return nameA.localeCompare(nameB, 'nn')
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
                          >
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
