import type { createServiceRoleClient } from '@/lib/supabase/server'
import { addQty } from '@/lib/quantity'

type DB = ReturnType<typeof createServiceRoleClient>

export interface MergeResult {
  added: number      // new lines
  merged: number     // quantity added to a line already on the list
  restored: number   // ticked-off line put back with the new quantity
  kept: number       // already on the list in a unit that can't be added (500 g + 2 stk)
}

/**
 * Put several items on a list at once without creating duplicate lines:
 * - not on the list → new line
 * - on the list, not ticked → quantities added (500 g + 400 g = 900 g)
 * - on the list, ticked off → unticked, quantity replaced
 * Callers must already have checked that the list and items belong to the household.
 */
export async function mergeIntoList(
  db: DB,
  listId: string,
  lines: { item_id: string; quantity: string }[],
): Promise<MergeResult> {
  const result: MergeResult = { added: 0, merged: 0, restored: 0, kept: 0 }
  if (lines.length === 0) return result

  // Combine duplicates in the input first (a recipe listing "løk" twice)
  const wanted = new Map<string, string>()
  for (const l of lines) {
    const prev = wanted.get(l.item_id)
    wanted.set(l.item_id, prev ? addQty(prev, l.quantity) ?? prev : l.quantity)
  }

  const { data: existing } = await db
    .from('list_items')
    .select('id, item_id, quantity, is_checked')
    .eq('list_id', listId)
    .in('item_id', Array.from(wanted.keys()))
  const byItem = new Map((existing || []).map((e: any) => [e.item_id, e]))

  const inserts: { list_id: string; item_id: string; quantity: string }[] = []
  const updates: PromiseLike<unknown>[] = []

  wanted.forEach((qty, itemId) => {
    const line = byItem.get(itemId)
    if (!line) {
      inserts.push({ list_id: listId, item_id: itemId, quantity: qty })
      result.added++
    } else if (line.is_checked) {
      updates.push(db.from('list_items').update({ is_checked: false, checked_at: null, quantity: qty }).eq('id', line.id))
      result.restored++
    } else {
      const sum = addQty(line.quantity, qty)
      if (sum) {
        updates.push(db.from('list_items').update({ quantity: sum }).eq('id', line.id))
        result.merged++
      } else {
        result.kept++
      }
    }
  })

  if (inserts.length) await db.from('list_items').insert(inserts)
  await Promise.all(updates)
  return result
}

/** Short Nynorsk summary for a notice: "4 nye, 2 auka". */
export function describeMerge(r: MergeResult): string {
  const parts: string[] = []
  if (r.added) parts.push(`${r.added} nye`)
  if (r.merged) parts.push(`${r.merged} auka`)
  if (r.restored) parts.push(`${r.restored} tilbake`)
  if (r.kept) parts.push(`${r.kept} uendra`)
  return parts.join(', ') || 'Ingen endring'
}
