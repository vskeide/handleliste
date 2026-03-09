'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getMeal, addMealItem, removeMealItem, updateMeal } from '@/lib/actions/meals'
import { searchItems, createItem } from '@/lib/actions/items'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plus, Search, X } from 'lucide-react'

export default function MealDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [meal, setMeal] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [highlightIndex, setHighlightIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  async function loadMeal() {
    const data = await getMeal(id)
    setMeal(data)
    setLoading(false)
  }

  useEffect(() => { loadMeal() }, [id])

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
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
    await loadMeal()
    setTimeout(() => searchRef.current?.focus(), 50)
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
        <p className="text-xs text-[#94A3B8] mt-1 ml-8">{meal.meal_items?.length || 0} ingrediensar</p>
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
                if (e.key === 'Enter' && searchResults.length > 0) {
                  e.preventDefault()
                  handleAddItem(searchResults[highlightIndex]?.id || searchResults[0].id)
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
            <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]) }}>
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
                <span className="text-xs text-[#94A3B8]">{mi.quantity}</span>
                <button onClick={() => handleRemoveItem(mi.id)} className="text-[#94A3B8] hover:text-red-500 flex-shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      <div className="fixed bottom-20 right-4 z-30">
        <Button onClick={() => setShowSearch(true)} className="rounded-full h-14 w-14 shadow-lg" size="icon">
          <Plus className="h-6 w-6" />
        </Button>
      </div>
    </div>
  )
}
