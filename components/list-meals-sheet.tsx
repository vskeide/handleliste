'use client'

import { useState } from 'react'
import { X, Trash2, ChevronDown, Users, Pencil } from 'lucide-react'
import type { ListMeal } from '@/lib/types'
import { formatQuantityDisplay, QuantityPickerSheet } from '@/components/quantity-picker-sheet'
import { scaleMealQty } from '@/lib/quantity'

export function ListMealsPanel({ meals, listName, onClose, onRemove, onServingsChange, onQuantityChange }: {
  meals: ListMeal[]; listName: string; onClose: () => void; onRemove: (mealId: string, itemId?: string) => void
  onServingsChange: (mealId:string,servings:number,fromServings?:number) => string | null
  onQuantityChange: (mealId:string,itemId:string,quantity:string) => string | null
}) {
  const [portionEdit,setPortionEdit]=useState<{id:string;value:string;from:string}|null>(null)
  const [quantityEdit,setQuantityEdit]=useState<{mealId:string;itemId:string}|null>(null)
  const [editError,setEditError]=useState<string|null>(null)
  const editingMeal=meals.find(m=>m.id===quantityEdit?.mealId)
  const editingIngredient=editingMeal?.ingredients.find(i=>i.item_id===quantityEdit?.itemId)
  return <section id="list-meals" aria-labelledby="list-meals-title" className="border-b bg-white px-4 pb-4">
      <div className="flex items-center justify-between border-b py-2">
        <h2 id="list-meals-title" className="min-w-0 font-bold">Middagar i «{listName}»</h2>
        <button type="button" onClick={onClose} aria-label="Lukk middagsoversikta" className="flex h-11 w-11 items-center justify-center"><X className="h-5 w-5" /></button>
      </div>
      <p className="py-3 text-xs text-[#64748B]">Endringane gjeld berre denne handlelista. Andre rettar og den lagra oppskrifta blir ikkje endra. Mengder du har overstyrt i hovudlista, blir ikkje skalerte automatisk.</p>
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
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => {setPortionEdit({id:meal.id,value:String(meal.servings ?? ''),from:''});setEditError(null)}}
              aria-label={`Endre porsjonar for ${meal.name}`} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#475569]">
              <Users className="h-4 w-4" />{meal.servings ? `${String(meal.servings).replace('.',',')} porsjonar` : 'Set porsjonar'}<Pencil className="h-3 w-3" />
            </button>
            <button type="button" aria-label={`Fjern ${meal.name} frå lista`} onClick={() => onRemove(meal.id)} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-red-600"><Trash2 className="h-4 w-4" />Fjern rett</button>
          </div>
          {portionEdit?.id===meal.id && <form className="mb-3 space-y-2 rounded-lg bg-slate-50 p-3" onSubmit={e => {
            e.preventDefault()
            const error=onServingsChange(meal.id,Number(portionEdit.value.replace(',','.')),meal.servings===null ? Number(portionEdit.from.replace(',','.')) : undefined)
            setEditError(error);if(!error)setPortionEdit(null)
          }}>
            {!meal.servings && <label className="block text-xs">Mengdene er no til kor mange porsjonar?
              <input type="number" min="0.5" max="100" step="0.5" required value={portionEdit.from} onChange={e=>setPortionEdit({...portionEdit,from:e.target.value})} className="mt-1 h-11 w-full rounded border bg-white px-2 text-base" />
            </label>}
            <label className="block text-xs">Nytt tal porsjonar
              <input type="number" min="0.5" max="100" step="0.5" required value={portionEdit.value} onChange={e=>setPortionEdit({...portionEdit,value:e.target.value})} className="mt-1 h-11 w-full rounded border bg-white px-2 text-base" />
            </label>
            <p className="text-xs text-[#64748B]">Mengdene til denne retten blir skalerte på lista.</p>
            {editError && <p role="alert" className="text-sm text-red-600">{editError}</p>}
            <div className="flex gap-2"><button type="submit" className="min-h-11 rounded-lg bg-primary px-3 text-sm text-white">Lagre porsjonar</button>
              <button type="button" onClick={()=>{setPortionEdit(null);setEditError(null)}} className="min-h-11 px-3 text-sm">Avbryt</button></div>
          </form>}
          {!meal.ingredients.length && <p className="py-2 text-xs text-[#64748B]">Ingen ingrediensar att.</p>}
          <ul className="divide-y">
            {meal.ingredients.map(ingredient => <li key={ingredient.item_id} className="flex items-center gap-2 py-1 text-sm">
              <span className={`min-w-0 flex-1 ${!ingredient.list_item_id ? 'text-[#94A3B8]' : ''}`}>{ingredient.name}
                {(!ingredient.list_item_id || !ingredient.quantity) && <span className="block text-xs text-[#64748B]">{!ingredient.list_item_id ? 'Ikkje på lista' : 'Endra manuelt i hovudlista'}</span>}
              </span>
              {ingredient.list_item_id && ingredient.quantity && <button type="button" aria-label={`Endre mengda av ${ingredient.name} i ${meal.name}`}
                onClick={()=>{setQuantityEdit({mealId:meal.id,itemId:ingredient.item_id});setEditError(null)}} className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs text-[#475569]">
                {scaleMealQty(ingredient.quantity,1,1)===null ? ingredient.quantity : formatQuantityDisplay(ingredient.quantity)}<Pencil className="h-3 w-3" />
              </button>}
              <button type="button" aria-label={`Fjern ${ingredient.name} frå ${meal.name}`} onClick={() => onRemove(meal.id,ingredient.item_id)} className="flex h-11 w-11 shrink-0 items-center justify-center text-[#64748B]"><X className="h-4 w-4" /></button>
            </li>)}
          </ul>
          </div>
        </details>)}
      </div>
      {quantityEdit && editingMeal && editingIngredient?.quantity && <QuantityPickerSheet key={`${quantityEdit.mealId}:${quantityEdit.itemId}`}
        title={`${editingIngredient.name} i ${editingMeal.name}`} currentQuantity={editingIngredient.quantity} error={editError}
        onSave={quantity=>{const error=onQuantityChange(quantityEdit.mealId,quantityEdit.itemId,quantity);setEditError(error);if(!error)setQuantityEdit(null)}}
        onClose={()=>{setQuantityEdit(null);setEditError(null)}} />}
  </section>
}
