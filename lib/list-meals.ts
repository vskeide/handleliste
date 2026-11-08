import { overlayWrites, type PendingWrite } from './list-outbox'
import { addQty, subtractQty, replaceMealQty, scaleMealQty } from './quantity'
import type { ListItem, ListMeal, ListMealIngredient } from './types'

/** Project pending meal changes with the same source rules as the transactional RPC. */
export function overlayListContents(base: ListItem[], savedMeals: ListMeal[], writes: PendingWrite[], listId: string) {
  let lines = base.map(l => ({ ...l }))
  let meals = savedMeals.map(m => ({ ...m, ingredients: m.ingredients.map(i => ({ ...i })) }))
  for (const write of writes) {
    const op = write.op
    // A refresh may see a committed write whose response was lost. Its source ID
    // proves this addition is already included in the atomic server snapshot.
    if (op.kind === 'batch' && op.meal && meals.some(m => m.id === op.meal!.id)) continue
    if (op.kind === 'mealServings' || op.kind === 'mealQty') {
      const meal=meals.find(m=>m.id===op.mealId)
      if (!meal) continue
      const from=meal.servings ?? (op.kind==='mealServings' ? op.fromServings : null)
      const changes: {line:ListItem; ingredient:ListMealIngredient; quantity:string; total:string}[]=[]
      let conflict=false
      for (const ingredient of meal.ingredients) {
        if (op.kind==='mealQty' && ingredient.item_id!==op.itemId) continue
        const line=lines.find(l=>l.id===ingredient.list_item_id)
        if (!line || !ingredient.quantity) continue
        const quantity=op.kind==='mealQty' ? op.quantity : scaleMealQty(ingredient.base_quantity ?? ingredient.quantity,ingredient.base_servings ?? from ?? 0,op.servings)
        if (!quantity) continue
        const total=replaceMealQty(line.quantity,ingredient.quantity,quantity)
        if (total===null) { conflict=true; break }
        changes.push({line,ingredient,quantity,total})
      }
      if (conflict || (op.kind==='mealServings' && !from)) continue
      for (const change of changes) {
        const {ingredient,line,quantity,total}=change
        if (op.kind==='mealQty') {ingredient.base_quantity=quantity;ingredient.base_servings=from}
        else {ingredient.base_quantity ??= ingredient.quantity;ingredient.base_servings ??= from}
        ingredient.quantity=quantity;line.quantity=total
      }
      if (op.kind==='mealServings') meal.servings=op.servings
    } else if (op.kind === 'mealRemove') {
      const meal = meals.find(m => m.id === op.mealId)
      for (const ingredient of meal?.ingredients ?? []) {
        if (op.itemId && ingredient.item_id !== op.itemId) continue
        const line = lines.find(l => l.id === ingredient.list_item_id)
        if (!line || !ingredient.quantity) continue
        const remainder = subtractQty(line.quantity, ingredient.quantity)
        if (remainder === '0') lines = lines.filter(l => l.id !== line.id)
        else if (remainder !== null) line.quantity = remainder
      }
      meals = op.itemId ? meals.map(m => m.id === op.mealId ? { ...m, ingredients: m.ingredients.filter(i => i.item_id !== op.itemId) } : m)
        : meals.filter(m => m.id !== op.mealId)
    } else {
      if (op.kind === 'qty') for (const meal of meals) for (const ingredient of meal.ingredients) {
        const line = lines.find(l => l.id === op.listItemId)
        if (ingredient.list_item_id === op.listItemId && line?.quantity !== op.quantity) ingredient.quantity = null
      }
      let ingredients: ListMealIngredient[] = []
      const additions = op.kind === 'batch' ? op.lines : op.kind === 'add' || op.kind === 'create' ? [{...op,quantity:op.quantity ?? '1'}] : []
      // Work sequentially so duplicate ingredients have the same merge behaviour as SQL.
      for (const entry of additions) {
        const before = lines.find(l => l.item_id === entry.itemId)
        if (before?.is_checked) for (const meal of meals) for (const i of meal.ingredients) if (i.list_item_id === before.id) i.list_item_id = null
        if (op.kind === 'batch' && op.meal) {
          const contributes = !before || before.is_checked || addQty(before.quantity,entry.quantity) !== null
          const existing = ingredients.find(i => i.item_id === entry.itemId)
          if (existing && contributes) { existing.quantity = addQty(existing.quantity ?? '0',entry.quantity); existing.list_item_id = before?.id ?? entry.clientId }
          else if (!existing) ingredients.push({item_id:entry.itemId,list_item_id:contributes ? before?.id ?? entry.clientId : null,
            name:entry.name ?? '',quantity:contributes ? entry.quantity : null})
        }
        lines = overlayWrites(lines,[{id:write.id,op:op.kind === 'batch' ? {...op,lines:[{...entry,sectionId:entry.sectionId ?? undefined}]} : op}],listId)
      }
      if (!additions.length) lines = overlayWrites(lines,[write],listId)
      if (op.kind === 'batch' && op.meal) meals.push({id:op.meal.id,name:op.meal.name,icon:op.meal.icon,servings:op.meal.servings,ingredients})
    }
    // Deleted/replaced list lines cannot be removed a second time by another meal.
    for (const meal of meals) for (const ingredient of meal.ingredients) if (!lines.some(l => l.id === ingredient.list_item_id)) ingredient.list_item_id = null
  }
  return { lines, meals }
}
