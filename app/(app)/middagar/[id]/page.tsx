'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getMeal, addMealItem, removeMealItem, updateMealItemQuantity, setMealServings, addRecipeTextToMeal } from '@/lib/actions/meals'
import { QuantityPickerSheet, formatQuantityDisplay } from '@/components/quantity-picker-sheet'
import { searchItems, createItem } from '@/lib/actions/items'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plus, Search, X, ClipboardPaste } from 'lucide-react'
import type { Section } from '@/lib/types'

export default function MealDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [meal, setMeal] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [sections, setSections] = useState<Section[]>([])
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [editingMealItemId, setEditingMealItemId] = useState<string | null>(null)
  const [servingsError, setServingsError] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  async function loadMeal() {
    const data = await getMeal(id)
    setMeal(data)
    setLoading(false)
  }

  useEffect(() => { loadMeal() }, [id])

  // Fetch sections for the create-new-item flow
  useEffect(() => {
    async function fetchSections() {
      const res = await fetch('/api/sections')
      if (res.ok) {
        const data = await res.json()
        setSections(data)
      }
    }
    fetchSections()
  }, [])

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
    setShowSectionPicker(false)
    if (query.length < 1) { setSearchResults([]); return }
    const results = await searchItems(query)
    const existingIds = new Set((meal?.meal_items || []).map((mi: any) => mi.item_id))
    setSearchResults(results.filter((r: any) => !existingIds.has(r.id)))
    setHighlightIndex(0)
  }, [meal])

  async function handleAddItem(itemId: string) {
    await addMealItem(id, itemId)
    setSearchQuery('')
    setSearchResults([])
    setShowSectionPicker(false)
    await loadMeal()
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  async function handleCreateAndAdd(sectionId: string) {
    const result = await createItem(newItemName, sectionId)
    if (result.item) {
      await addMealItem(id, result.item.id)
      await loadMeal()
    }
    setNewItemName('')
    setShowSectionPicker(false)
    setSearchQuery('')
    setSearchResults([])
    setTimeout(() => searchRef.current?.focus(), 50)
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
            <Link href="/middagar" className="text-[#64748B] hover:text-[#0F172A] flex-shrink-0">
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
              placeholder="Søk etter ingrediensar..."
              className="border-0 shadow-none focus-visible:ring-0 h-8"
              autoFocus
            />
            <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); setShowSectionPicker(false) }}>
              <X className="h-4 w-4 text-[#94A3B8]" />
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
              {searchResults.map((item: any, index: number) => (
                <button
                  key={item.id}
                  onClick={() => handleAddItem(item.id)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  className={`flex items-center gap-2 w-full rounded-lg p-2 text-left transition-colors ${
                    index === highlightIndex ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-[#F1F5F9]'
                  }`}
                >
                  <span className="text-sm">{item.sections?.icon}</span>
                  <span className="text-sm">{item.name}</span>
                  {index === highlightIndex && (
                    <span className="text-[10px] text-[#94A3B8] ml-auto">↵</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Create new item button */}
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
                Opprett &quot;{searchQuery}&quot;
              </span>
            </button>
          )}

          {/* Section picker for new items */}
          {showSectionPicker && (
            <div className="mt-2 space-y-1 border-t pt-2">
              <p className="text-xs text-[#64748B] mb-1">Vel kategori for ny vare:</p>
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

      {/* FAB */}
      <div className="fixed bottom-20 right-4 z-30">
        <Button onClick={() => setShowSearch(true)} className="rounded-full h-14 w-14 shadow-lg" size="icon">
          <Plus className="h-6 w-6" />
        </Button>
      </div>
    </div>
  )
}
