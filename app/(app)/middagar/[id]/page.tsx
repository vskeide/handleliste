'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getMeal, addMealItem, removeMealItem, updateMealItemQuantity, setMealServings, addRecipeTextToMeal, addMealToList } from '@/lib/actions/meals'
import { QuantityPickerSheet, formatQuantityDisplay } from '@/components/quantity-picker-sheet'
import { getHouseholdItems, createItem } from '@/lib/actions/items'
import { searchAll, guessSection, displayName, norm, type KnownItem } from '@/lib/match'
import { parseEntry } from '@/lib/parse-list'
import type { CatalogProduct } from '@/lib/catalog-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plus, Search, X, ClipboardPaste } from 'lucide-react'
import type { Section } from '@/lib/types'

interface IngredientHit extends KnownItem {
  sections?: Section
  catalog?: CatalogProduct
}

export default function MealDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // Set when the dinner was created from a shopping list's add field
  const toList = useSearchParams().get('tilListe')
  const [addingToList, setAddingToList] = useState(false)
  const [meal, setMeal] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [householdItems, setHouseholdItems] = useState<IngredientHit[]>([])
  const [searchLoading, setSearchLoading] = useState(true)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [sections, setSections] = useState<Section[]>([])
  const [editingMealItemId, setEditingMealItemId] = useState<string | null>(null)
  const [servingsError, setServingsError] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const loadMeal = useCallback(async () => {
    const data = await getMeal(id)
    setMeal(data)
    setLoading(false)
  }, [id])

  useEffect(() => { void loadMeal() }, [loadMeal])

  // Load once; every keystroke then searches the household and catalogue locally.
  useEffect(() => {
    let active = true
    async function loadSearch() {
      try {
        const [items, res] = await Promise.all([getHouseholdItems(), fetch('/api/sections')])
        if (!res.ok) throw new Error('Sections unavailable')
        const data: Section[] = await res.json()
        if (!active) return
        setHouseholdItems(items)
        setSections(data)
      } catch {
        if (active) setSearchError('Kunne ikkje laste varesøket. Last sida på nytt for å prøve igjen.')
      } finally {
        if (active) setSearchLoading(false)
      }
    }
    void loadSearch()
    return () => { active = false }
  }, [])

  const searchResults = useMemo<IngredientHit[]>(() => {
    const existingIds = new Set<string>((meal?.meal_items || []).map((mi: any) => mi.item_id))
    const existingNames = new Set<string>((meal?.meal_items || []).map((mi: any) => norm(mi.items?.name || '')))
    const term = parseEntry(searchQuery).name
    return searchAll(householdItems, term, householdItems.length + 500)
      .filter((hit) => hit.kind === 'item' ? !existingIds.has(hit.item.id) && !existingNames.has(norm(hit.item.name)) : !existingNames.has(norm(hit.product.name)))
      .slice(0, 20)
      .map((hit) => {
        const name = hit.kind === 'item' ? hit.item.name : hit.product.name
        const section = sections.find((s) => hit.kind === 'item' ? s.id === hit.item.section_id : s.name_nn === hit.product.section)
        return hit.kind === 'item'
          ? { ...hit.item, sections: section }
          : { id: `cat:${name}`, name, section_id: section?.id ?? null, sections: section, catalog: hit.product }
      })
  }, [householdItems, searchQuery, sections, meal])

  function handleSearch(query: string) {
    setSearchQuery(query)
    setHighlightIndex(0)
  }

  async function handleAddItem(hit?: IngredientHit) {
    if (addingItem || searchLoading || !sections.length) return
    const parsed = parseEntry(searchQuery)
    const name = hit?.name ?? displayName(parsed.name)
    if (!name) return
    setAddingItem(true)
    setSearchError(null)
    try {
      let itemId = hit && !hit.catalog ? hit.id : householdItems.find((item) => norm(item.name) === norm(name))?.id
      if (!itemId) {
        const sectionName = hit?.catalog?.section ?? guessSection(name) ?? 'Tørrvarer'
        const sectionId = hit?.section_id ?? sections.find((s) => s.name_nn === sectionName)?.id ?? sections[0].id
        const result = await createItem(name, sectionId)
        if (!result.item) { setSearchError(result.error || 'Kunne ikkje opprette vare'); return }
        itemId = result.item.id
        setHouseholdItems((prev) => [...prev, result.item])
      }
      const quantity = parsed.quantity !== '1' ? parsed.quantity : hit?.catalog?.qty ?? '1'
      const result = await addMealItem(id, itemId!, quantity)
      if ('error' in result && result.error) { setSearchError(result.error); return }
      setSearchQuery('')
      setHighlightIndex(0)
      await loadMeal()
    } catch {
      setSearchError('Kunne ikkje leggje til ingrediensen. Prøv igjen.')
    } finally {
      setAddingItem(false)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }

  async function handleAddToList() {
    if (!toList) return
    setAddingToList(true)
    const r: any = await addMealToList(id, toList)
    if (r?.error) { setAddingToList(false); setPasteNote(r.error); return }
    router.push(`/lister/${toList}`)
  }

  async function handlePaste() {
    setPasting(true)
    const r: any = await addRecipeTextToMeal(id, pasteText)
    setPasting(false)
    if (r?.error) { setPasteNote(r.error); return }
    setPasteText('')
    setShowPaste(false)
    const parts = [`${r.added} lagt til`]
    if (r.updated) parts.push(`${r.updated} auka`)
    if (r.unknown?.length) parts.push(`nye varer: ${r.unknown.join(', ')} – sjekk kategori i handlelista`)
    setPasteNote(parts.join(' · '))
    await loadMeal()
  }

  async function changeServings(n: number) {
    const next = Math.min(20, Math.max(1, n))
    const prev = meal.servings ?? null
    setMeal((m: any) => ({ ...m, servings: next }))
    setServingsError(null)
    const r = await setMealServings(id, next)
    if ('error' in r && r.error) {
      setMeal((m: any) => ({ ...m, servings: prev }))
      setServingsError(r.error)
    }
  }

  async function handleMealItemQuantityUpdate(mealItemId: string, quantity: string) {
    setMeal((prev: any) => ({
      ...prev,
      meal_items: prev.meal_items.map((mi: any) =>
        mi.id === mealItemId ? { ...mi, quantity } : mi
      ),
    }))
    setEditingMealItemId(null)
    await updateMealItemQuantity(mealItemId, quantity)
  }

    async function handleRemoveItem(mealItemId: string) {
    await removeMealItem(mealItemId)
    setMeal((prev: any) => ({
      ...prev,
      meal_items: prev.meal_items.filter((mi: any) => mi.id !== mealItemId),
    }))
  }

  if (loading) return <div className="mx-auto max-w-lg px-4 pt-6"><p className="text-center text-[#94A3B8] py-8">Lastar...</p></div>
  if (!meal) return <div className="mx-auto max-w-lg px-4 pt-6"><p className="text-center text-[#94A3B8] py-8">Middag ikkje funnen</p></div>

  return (
    <div className="mx-auto max-w-lg pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={toList ? `/lister/${toList}` : '/middagar'} className="text-[#64748B] hover:text-[#0F172A] flex-shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="text-xl">{meal.icon}</span>
            <h1 className="text-lg font-bold text-[#0F172A] truncate">{meal.name}</h1>
          </div>
          <button onClick={() => setShowSearch(true)} className="text-[#64748B]">
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-1 ml-8 text-xs text-[#94A3B8]">
          <span>{meal.meal_items?.length || 0} ingrediensar ·</span>
          {/* How many people the amounts are for; the list scales to the household size */}
          <div className="flex items-center gap-1" title="Mengdene i oppskrifta er for så mange personar">
            <button
              onClick={() => changeServings((meal.servings ?? 4) - 1)}
              className="h-6 w-6 rounded-full border text-[#64748B] leading-none"
              aria-label="Færre personar"
            >−</button>
            <span className="min-w-[4.5rem] text-center text-[#0F172A]">
              {meal.servings ? `for ${meal.servings} pers.` : 'ikkje skalert'}
            </span>
            <button
              onClick={() => changeServings((meal.servings ?? 3) + 1)}
              className="h-6 w-6 rounded-full border text-[#64748B] leading-none"
              aria-label="Fleire personar"
            >+</button>
          </div>
        </div>
        {servingsError && <p className="text-xs text-red-600 mt-1 ml-8">{servingsError}</p>}
        <button
          onClick={() => setShowPaste((v) => !v)}
          className="mt-2 ml-8 flex items-center gap-1 text-xs text-primary"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Lim inn oppskrift
        </button>
        {showPaste && (
          <div className="mt-2 space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Éin ingrediens per linje, t.d.\n400 g kjøtdeig\n1 boks hakka tomat\n2 løk'}
              rows={6}
              className="w-full rounded-lg border p-2 text-sm"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button onClick={handlePaste} disabled={pasting || !pasteText.trim()} size="sm">
                {pasting ? 'Legg til…' : 'Legg til ingrediensane'}
              </Button>
              <button onClick={() => { setShowPaste(false); setPasteText('') }} className="text-xs text-[#94A3B8]">Avbryt</button>
            </div>
          </div>
        )}
        {pasteNote && <p className="mt-2 text-xs text-[#64748B]">{pasteNote}</p>}
      </div>

      {/* Search overlay */}
      {showSearch && (
        <div className="border-b bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-[#94A3B8] flex-shrink-0" />
            <Input
              ref={searchRef}
              value={searchQuery}
              disabled={searchLoading || addingItem || !sections.length}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (searchResults.length > 0) {
                    void handleAddItem(searchResults[highlightIndex] || searchResults[0])
                  } else if (searchQuery.trim().length > 0) {
                    void handleAddItem()
                  }
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlightIndex((i) => Math.max(0, Math.min(i + 1, searchResults.length - 1)))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlightIndex((i) => Math.max(i - 1, 0))
                }
              }}
              placeholder={searchLoading ? 'Lastar varer…' : 'Søk etter ingrediensar...'}
              className="border-0 shadow-none focus-visible:ring-0 h-8"
              autoFocus
            />
            <button onClick={() => { setShowSearch(false); setSearchQuery('') }}>
              <X className="h-4 w-4 text-[#94A3B8]" />
            </button>
          </div>
          {searchError && <p role="alert" className="mt-2 text-xs text-red-600">{searchError}</p>}

          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
              {searchResults.map((item: any, index: number) => (
                <button
                  key={item.id}
                  onClick={() => handleAddItem(item)}
                  disabled={addingItem || searchLoading}
                  onMouseEnter={() => setHighlightIndex(index)}
                  className={`flex items-center gap-2 w-full rounded-lg p-2 text-left transition-colors ${
                    index === highlightIndex ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-[#F1F5F9]'
                  }`}
                >
                  <span className="text-sm">{item.sections?.icon}</span>
                  <span className="text-sm">{item.name}</span>
                  <span className="text-xs text-[#64748B]">{item.sections?.name_nn}</span>
                  {index === highlightIndex && (
                    <span className="text-[10px] text-[#94A3B8] ml-auto">↵</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Create new item button */}
          {searchQuery.trim().length > 0 && !searchLoading && (
            <button
              onClick={() => handleAddItem()}
              disabled={addingItem || !sections.length}
              className="mt-2 flex items-center gap-2 w-full rounded-lg p-2 text-left hover:bg-[#F1F5F9] text-primary"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm font-medium">
                Legg til &quot;{parseEntry(searchQuery).name}&quot;
              </span>
            </button>
          )}

        </div>
      )}

      {(meal.source_url || meal.recipe_text) && (
        <div className="px-4 pt-3 space-y-3">
          {meal.source_url && /^https?:\/\//i.test(meal.source_url) && <a href={meal.source_url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-blue-700 underline">Opne oppskrifta</a>}
          {meal.recipe_text && <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Tilreiing</summary><p className="mt-3 whitespace-pre-wrap text-sm">{meal.recipe_text}</p></details>}
        </div>
      )}

      {/* Ingredient list */}
      <div className="px-4 py-3">
        {(!meal.meal_items || meal.meal_items.length === 0) ? (
          <div className="text-center py-12">
            <p className="text-[#64748B] mb-3">Legg til ingrediensar</p>
            <Button onClick={() => setShowSearch(true)} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Legg til ingrediens
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {meal.meal_items.map((mi: any) => (
              <div
                key={mi.id}
                className="flex items-center gap-3 rounded-lg bg-white p-3 border border-[#E2E8F0]"
              >
                <span className="text-sm">{mi.items?.sections?.icon}</span>
                <span className="text-sm text-[#0F172A] flex-1">{mi.items?.name}</span>
                <button
                  onClick={() => setEditingMealItemId(mi.id)}
                  className={`text-xs flex-shrink-0 px-1.5 py-0.5 rounded-full transition-colors ${
                    mi.quantity === '1'
                      ? 'text-[#94A3B8]'
                      : 'bg-[#D1FAE5] text-[#059669] font-medium'
                  }`}
                >
                  {formatQuantityDisplay(mi.quantity)}
                </button>
                <button onClick={() => handleRemoveItem(mi.id)} className="text-[#94A3B8] hover:text-red-500 flex-shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quantity picker sheet */}
      {editingMealItemId && (() => {
        const mi = meal.meal_items.find((x: any) => x.id === editingMealItemId)
        return mi ? (
          <QuantityPickerSheet
            currentQuantity={mi.quantity}
            onSave={(q) => handleMealItemQuantityUpdate(mi.id, q)}
            onClose={() => setEditingMealItemId(null)}
          />
        ) : null
      })()}

      {/* Opened from a shopping list ("Lag middag «…»"): finish by putting it on that list */}
      {toList ? (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-30">
          <div className="mx-auto max-w-lg px-4 flex gap-2">
            <Button
              onClick={handleAddToList}
              disabled={addingToList || !meal.meal_items?.length}
              className="flex-1 h-12 shadow-lg"
            >
              {addingToList ? 'Legg til…' : `Legg ${meal.meal_items?.length || 0} varer i lista`}
            </Button>
            <Button onClick={() => setShowSearch(true)} variant="outline" className="h-12 w-12 bg-white shadow-lg" size="icon" aria-label="Legg til ingrediens">
              <Plus className="h-5 w-5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30">
          <Button onClick={() => setShowSearch(true)} className="rounded-full h-14 w-14 shadow-lg" size="icon">
            <Plus className="h-6 w-6" />
          </Button>
        </div>
      )}
    </div>
  )
}
