// Turn typed text into list lines:
//   "mjølk, 2 kg potet, 3 egg og rømme"  →  mjølk · 2 kg potet · 3 egg · rømme
//   "400 g kjøtdeig\n1 boks hakka tomat" (a pasted recipe) works the same way.
// No AI: amounts and units are read with patterns; matching names to items is the
// caller's job.

import { formatQty, type Unit } from './quantity'

export interface ParsedLine { name: string; quantity: string }

const UNIT_WORDS: Record<string, Unit> = {
  stk: 'stk', st: 'stk', stykk: 'stk', boks: 'stk', boksar: 'stk', bokser: 'stk',
  g: 'g', gr: 'g', gram: 'g',
  kg: 'kg', kilo: 'kg',
  dl: 'dl',
  l: 'L', liter: 'L', litar: 'L',
  ml: 'ml',
  pk: 'pakke', pakke: 'pakke', pakkar: 'pakke', pakker: 'pakke', pose: 'pakke', posar: 'pakke', poser: 'pakke',
  porsjon: 'porsjon', porsjonar: 'porsjon', porsjoner: 'porsjon',
}

const NUM = '(\\d+(?:[.,]\\d+)?|½|¼|¾)'
const UNIT = `(${Object.keys(UNIT_WORDS).join('|')})\\.?`
// The number must be followed by a unit or a space, so "7-up" stays a name
const LEAD = new RegExp(`^${NUM}(?:\\s*${UNIT}\\s+|\\s+)(.+)$`, 'i')   // "2 kg potet", "3 egg", "2kg potet"
const TRAIL = new RegExp(`^(.+?)\\s+${NUM}\\s*(?:${UNIT})?$`, 'i') // "potet 2 kg", "egg 3"

function toNumber(s: string): number {
  if (s === '½') return 0.5
  if (s === '¼') return 0.25
  if (s === '¾') return 0.75
  return parseFloat(s.replace(',', '.'))
}

function clean(name: string): string {
  return name
    .replace(/^[-*•·\s]+/, '')       // list bullets from pasted recipes
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Split typed or pasted text into one line per item. */
export function splitEntries(text: string): string[] {
  return text
    .split(/[\n,;]+|\s+og\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Read the amount and unit off one entry. Without an amount the quantity is "1". */
export function parseEntry(entry: string): ParsedLine {
  const s = clean(entry)
  let m = s.match(LEAD)
  if (m && m[3]) {
    const unit = m[2] ? UNIT_WORDS[m[2].toLowerCase()] : 'stk'
    return { name: clean(m[3]), quantity: formatQty({ amount: toNumber(m[1]), unit }) }
  }
  m = s.match(TRAIL)
  if (m && m[1]) {
    const unit = m[3] ? UNIT_WORDS[m[3].toLowerCase()] : 'stk'
    return { name: clean(m[1]), quantity: formatQty({ amount: toNumber(m[2]), unit }) }
  }
  return { name: s, quantity: '1' }
}

/** True when the text holds more than one entry (so Enter should add them all). */
export function isMultiEntry(text: string): boolean {
  return splitEntries(text).length > 1
}
