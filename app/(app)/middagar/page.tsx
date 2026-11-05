'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getMeals, createMeal, deleteMeal, saveStarterMeal } from '@/lib/actions/meals'
import { STARTER_MEALS } from '@/lib/starter-meals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, UtensilsCrossed, Trash2, X } from 'lucide-react'

const MEAL_ICONS = ['🌮', '🍕', '🍝', '🍛', '🥗', '🍔', '🐟', '🥘', '🍲', '🍖', '🥩', '🍜', '🍣', '🥙', '🍽️']

export default function MealsPage() {
  const router = useRouter()
  const [meals, setMeals] = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('🍽️')
  const [loading, setLoading] = useState(true)
  const [savingStarter, setSavingStarter] = useState<string | null>(null)

  useEffect(() => {
    getMeals().then((data) => { setMeals(data); setLoading(false) })
  }, [])

  async function handleCreate() {
    if (!newName.trim()) return
    const result = await createMeal(newName.trim(), newIcon)
    if (result.meal) {
      router.push(`/middagar/${result.meal.id}`)
    }
  }

  async function handleSaveStarter(name: string) {
    setSavingStarter(name)
    const r: any = await saveStarterMeal(name)
    setSavingStarter(null)
    if (r?.meal) router.push(`/middagar/${r.meal.id}`)
    else alert(r?.error || 'Kunne ikkje lagre')
  }

  async function handleDelete(e: React.MouseEvent, mealId: string) {
    e.preventDefault()
    e.stopPropagation()
    const meal = meals.find((m) => m.id === mealId)
    if (!confirm(`Slette middagen «${meal?.name ?? ''}»? Dette kan ikkje angrast.`)) return
    await deleteMeal(mealId)
    setMeals((prev) => prev.filter((m) => m.id !== mealId))
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#0F172A]">Middagar</h1>
        <Button onClick={() => setShowCreate(true)} size="icon" className="rounded-full h-10 w-10">
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {/* Create new meal */}
      {showCreate && (
        <div className="rounded-xl bg-white p-4 shadow-sm border border-[#E2E8F0] mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              placeholder="Namn på middagen..."
              autoFocus
            />
            <Button onClick={handleCreate} size="sm">Lag</Button>
            <button onClick={() => { setShowCreate(false); setNewName('') }}>
              <X className="h-4 w-4 text-[#94A3B8]" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {MEAL_ICONS.map((icon) => (
              <button
                key={icon}
                onClick={() => setNewIcon(icon)}
                className={`text-xl p-1 rounded ${newIcon === icon ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-[#F1F5F9]'}`}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-[#94A3B8] py-8">Lastar...</p>
      ) : meals.length === 0 ? (
        <div className="text-center py-12">
          <UtensilsCrossed className="mx-auto h-12 w-12 text-[#94A3B8] mb-3" />
          <p className="text-[#64748B] mb-1">Ingen middagar enno</p>
          <p className="text-xs text-[#94A3B8] mb-4">Lag middagar med ingrediensar du kan legge rett inn i handlelista</p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Lag ny middag
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {meals.map((meal: any) => {
            const count = meal.meal_items?.[0]?.count || 0
            return (
              <Link
                key={meal.id}
                href={`/middagar/${meal.id}`}
                className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm border border-[#E2E8F0] hover:border-[#94A3B8] transition-colors"
              >
                <span className="text-2xl">{meal.icon}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-[#0F172A] truncate">{meal.name}</h3>
                  <span className="text-xs text-[#94A3B8]">
                    {count} ingrediensar{meal.servings ? ` · for ${meal.servings} pers.` : ''}
                  </span>
                </div>
                <button
                  onClick={(e) => handleDelete(e, meal.id)}
                  className="text-[#94A3B8] hover:text-red-500 flex-shrink-0 p-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Link>
            )
          })}
        </div>
      )}

      {/* Starter dinners: save one as your own to edit it; they also show up when you
          search in a shopping list */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-[#64748B] mb-2">Forslag ({STARTER_MEALS.length})</h2>
        <div className="grid grid-cols-1 gap-1.5">
          {STARTER_MEALS.filter((s) => !meals.some((m) => m.name.toLowerCase() === s.name.toLowerCase())).map((s) => (
            <div key={s.name} className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2">
              <span className="text-lg">{s.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#0F172A] truncate">{s.name}</p>
                <p className="text-[11px] text-[#94A3B8]">{s.ingredients.length} ingrediensar · for {s.servings}</p>
              </div>
              <button
                onClick={() => handleSaveStarter(s.name)}
                disabled={savingStarter === s.name}
                className="text-xs text-primary px-2 py-1 rounded border border-primary/30"
              >
                {savingStarter === s.name ? 'Lagrar…' : 'Lagre'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
