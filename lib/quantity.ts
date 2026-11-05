// Quantities are stored as text: "3" (pieces) or "<amount> <unit>" ("500 g", "1.5 L").
// These helpers add and scale them. Pure functions, safe on server and phone.

export const UNITS = ['stk', 'g', 'kg', 'dl', 'L', 'ml', 'pakke', 'porsjon'] as const
export type Unit = (typeof UNITS)[number]

export interface Qty { amount: number; unit: Unit }

/** Same rules as the quantity picker: "3" → 3 stk, "500 g" → 500 g, else 1 stk. */
export function parseQty(q: string | null | undefined): Qty {
  const s = (q ?? '').trim().replace(',', '.')
  if (/^\d+(\.\d+)?$/.test(s)) return { amount: parseFloat(s) || 1, unit: 'stk' }
  const m = s.match(/^(\d+(?:\.\d+)?)\s+(\S+)$/)
  if (m && (UNITS as readonly string[]).includes(m[2])) return { amount: parseFloat(m[1]) || 1, unit: m[2] as Unit }
  return { amount: 1, unit: 'stk' }
}

export function formatQty({ amount, unit }: Qty): string {
  const a = Math.round(amount * 100) / 100
  return unit === 'stk' ? String(a) : `${a} ${unit}`
}

// Weight and volume convert to a base unit so 500 g + 1 kg = 1.5 kg
const BASE: Partial<Record<Unit, { base: 'g' | 'ml'; factor: number }>> = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  dl: { base: 'ml', factor: 100 },
  L: { base: 'ml', factor: 1000 },
}

function fromBase(base: 'g' | 'ml', value: number): Qty {
  if (base === 'g') return value >= 1000 ? { amount: value / 1000, unit: 'kg' } : { amount: value, unit: 'g' }
  if (value >= 1000) return { amount: value / 1000, unit: 'L' }
  if (value >= 100 && value % 100 === 0) return { amount: value / 100, unit: 'dl' }
  return { amount: value, unit: 'ml' }
}

/** a + b, or null when the units can't be added (500 g + 2 stk). */
export function addQty(a: string, b: string): string | null {
  const x = parseQty(a), y = parseQty(b)
  if (x.unit === y.unit) return formatQty({ amount: x.amount + y.amount, unit: x.unit })
  const bx = BASE[x.unit], by = BASE[y.unit]
  if (bx && by && bx.base === by.base) {
    return formatQty(fromBase(bx.base, x.amount * bx.factor + y.amount * by.factor))
  }
  return null
}

/** Subtract a known meal contribution; never guess units for free-form quantities. */
export function subtractQty(a: string, b: string): string | null {
  if (a.trim() === b.trim()) return '0'
  const valid = /^(\d+(?:[.,]\d+)?)(?: (stk|g|kg|ml|dl|L|pakke|porsjon))?$/
  const ax = a.trim().match(valid), by = b.trim().match(valid)
  if (!ax || !by) return null
  const x: Qty = {amount:Number(ax[1].replace(',','.')),unit:(ax[2] ?? 'stk') as Unit}
  const y: Qty = {amount:Number(by[1].replace(',','.')),unit:(by[2] ?? 'stk') as Unit}
  let value: number
  if (x.unit === y.unit) value = x.amount - y.amount
  else {
    const bx = BASE[x.unit], by = BASE[y.unit]
    if (!bx || !by || bx.base !== by.base) return null
    value = x.amount * bx.factor - y.amount * by.factor
    return value <= 0 ? '0' : formatQty(fromBase(bx.base, value))
  }
  return value <= 0 ? '0' : formatQty({ amount: value, unit: x.unit })
}

/** Scale for a different number of people, rounded to amounts you can buy. */
export function scaleQty(q: string, factor: number): string {
  if (!isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) return q
  const { amount, unit } = parseQty(q)
  const v = amount * factor
  let r: number
  switch (unit) {
    case 'stk': case 'pakke': case 'porsjon': r = Math.max(1, Math.ceil(v - 0.25)); break
    case 'g': r = Math.max(50, Math.round(v / 50) * 50); break
    case 'ml': r = Math.max(50, Math.round(v / 50) * 50); break
    case 'kg': case 'L': r = Math.max(0.5, Math.round(v * 2) / 2); break
    case 'dl': r = Math.max(0.5, Math.round(v * 2) / 2); break
  }
  return formatQty({ amount: r, unit })
}
