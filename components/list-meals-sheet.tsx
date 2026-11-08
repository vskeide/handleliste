'use client'

import { useEffect, useRef } from 'react'
import { X, Trash2, ChevronDown } from 'lucide-react'
import type { ListMeal } from '@/lib/types'
import { formatQuantityDisplay } from '@/components/quantity-picker-sheet'
import { useBodyScrollLock } from '@/lib/hooks/use-body-scroll-lock'

export function ListMealsSheet({ meals, listName, onClose, onRemove }: {
  meals: ListMeal[]; listName: string; onClose: () => void; onRemove: (mealId: string, itemId?: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useBodyScrollLock()
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }, [])
  return <dialog ref={dialog} aria-labelledby="list-meals-title" onClose={onClose}
    onClick={e => { if (e.target === e.currentTarget) onClose() }}
    className="fixed inset-0 m-0 mt-auto max-h-[80dvh] w-full max-w-none rounded-t-2xl bg-white p-0 text-[#0F172A] backdrop:bg-black/30">
    <div className="mx-auto max-w-lg px-4 pb-8">
      <div className="sticky top-0 flex items-center justify-between border-b bg-white py-2">
        <h2 id="list-meals-title" className="min-w-0 font-bold">Middagar i «{listName}»</h2>
        <button type="button" onClick={onClose} aria-label="Lukk middagsoversikta" className="flex h-11 w-11 items-center justify-center"><X className="h-5 w-5" /></button>
      </div>
      <p className="py-3 text-xs text-[#64748B]">Endringane gjeld berre denne handlelista. Mengder til andre rettar blir ståande. Mengder du har endra manuelt, blir òg ståande.</p>
      {!meals.length && <p className="py-4 text-sm text-[#64748B]">Ingen middagar er lagde til enno. Oversikta gjeld rettar du legg til frå no av.</p>}
      <div className="space-y-3">
        {meals.map(meal => <details key={meal.id} className="group rounded-xl border">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 p-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1 truncate font-semibold" title={meal.name}>{meal.icon} {meal.name}
              {meal.servings && <span className="ml-2 text-xs font-normal text-[#64748B]">{String(meal.servings).replace('.', ',')} porsjonar</span>}
            </span>
            <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 text-[#64748B] transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t px-3 pb-2">
          <div className="flex justify-end">
            <button type="button" aria-label={`Fjern ${meal.name} frå lista`} onClick={() => onRemove(meal.id)} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-red-600"><Trash2 className="h-4 w-4" />Fjern rett</button>
          </div>
          {!meal.ingredients.length && <p className="py-2 text-xs text-[#64748B]">Ingen ingrediensar att.</p>}
          <ul className="divide-y">
            {meal.ingredients.map(ingredient => <li key={ingredient.item_id} className="flex items-center gap-2 py-1 text-sm">
              <span className={`min-w-0 flex-1 ${!ingredient.list_item_id ? 'text-[#94A3B8]' : ''}`}>{ingredient.name}
                <span className="block text-xs text-[#64748B]">{!ingredient.list_item_id ? 'Ingen mengd å fjerne' : ingredient.quantity ? formatQuantityDisplay(ingredient.quantity) : 'Endra manuelt – mengda blir behalden'}</span>
              </span>
              <button type="button" aria-label={`Fjern ${ingredient.name} frå ${meal.name}`} onClick={() => onRemove(meal.id,ingredient.item_id)} className="flex h-11 w-11 shrink-0 items-center justify-center text-[#64748B]"><X className="h-4 w-4" /></button>
            </li>)}
          </ul>
          </div>
        </details>)}
      </div>
    </div>
  </dialog>
}
