// Matching typed names to things the app knows: the household's own items first,
// then the generic product catalogue (lib/catalog-data.ts). Pure; runs on the phone
// (instant search) and on the server (pasted recipes).

import { CATALOG, type CatalogProduct, type SectionName } from './catalog-data'

export interface KnownItem {
  id: string
  name: string
  section_id: string | null
  times_purchased?: number
}

export type Hit =
  | { kind: 'item'; item: KnownItem; rank: number }
  | { kind: 'catalog'; product: CatalogProduct; rank: number }

export function norm(s: string): string {
  return s.toLocaleLowerCase('nn').replace(/\s+/g, ' ').trim()
}

/** 0 = starts with, 1 = a word starts with, 2 = anywhere, -1 = no match. */
function rankOf(text: string, q: string): number {
  const at = text.indexOf(q)
  if (at < 0) return -1
  if (at === 0) return 0
  return /[\s(\-/]/.test(text[at - 1]) ? 1 : 2
}

const catalogByName = new Map(CATALOG.map((p) => [norm(p.name), p]))
const catalogByAlias = new Map<string, CatalogProduct[]>()
for (const p of CATALOG) {
  for (const a of p.aliases ?? []) {
    const k = norm(a)
    catalogByAlias.set(k, [...(catalogByAlias.get(k) ?? []), p])
  }
}

/** Words an item can be found by: its name plus the catalogue's aliases for that name. */
function searchWords(name: string): string[] {
  const n = norm(name)
  return [n, ...(catalogByName.get(n)?.aliases ?? []).map(norm)]
}

function bestRank(words: string[], q: string): number {
  let r = -1
  for (const w of words) {
    const x = rankOf(w, q)
    if (x >= 0 && (r < 0 || x < r)) r = x
  }
  return r
}

/**
 * Search household items and the catalogue together. Household items win ties and
 * hide a catalogue product with the same name, so nothing shows twice.
 */
export function searchAll(items: KnownItem[], query: string, limit = 20): Hit[] {
  const q = norm(query)
  if (!q) return []
  const hits: (Hit & { score: number })[] = []
  const ownNames = new Set<string>()

  for (const item of items) {
    const n = norm(item.name)
    ownNames.add(n)
    // Own items are also found by the catalogue's spellings ("kjøttdeig" → Kjøtdeig)
    const r = bestRank(searchWords(item.name), q)
    if (r < 0) continue
    hits.push({ kind: 'item', item, rank: r, score: r * 1e6 - (item.times_purchased || 0) * 100 + n.length - 50 })
  }

  for (const product of CATALOG) {
    const n = norm(product.name)
    if (ownNames.has(n)) continue
    const r = bestRank([n, ...(product.aliases ?? []).map(norm)], q)
    if (r < 0) continue
    hits.push({ kind: 'catalog', product, rank: r, score: r * 1e6 + n.length })
  }

  hits.sort((a, b) => a.score - b.score)
  return hits.slice(0, limit)
}

/**
 * What a typed or pasted entry most likely means. Exact names and aliases first;
 * otherwise the best hit only if it starts with the text (so "egg" finds "Egg" but
 * "kyllingvingar" doesn't silently become "Kyllingfilet"). Null = unknown, create it.
 */
export function resolveName(items: KnownItem[], name: string): Hit | null {
  const n = norm(name)
  if (!n) return null
  const own = items.find((i) => norm(i.name) === n)
  if (own) return { kind: 'item', item: own, rank: 0 }

  const byName = catalogByName.get(n)
  if (byName) {
    const ownSame = items.find((i) => norm(i.name) === norm(byName.name))
    return ownSame ? { kind: 'item', item: ownSame, rank: 0 } : { kind: 'catalog', product: byName, rank: 0 }
  }

  // An alias can belong to several products ("melk" → Lettmjølk, Heilmjølk, …).
  // Prefer the one the household buys most; otherwise the plainest (shortest) name.
  const candidates = catalogByAlias.get(n) ?? []
  if (candidates.length) {
    const owned = items
      .filter((i) => candidates.some((p) => norm(p.name) === norm(i.name)))
      .sort((a, b) => (b.times_purchased || 0) - (a.times_purchased || 0))
    if (owned.length) return { kind: 'item', item: owned[0], rank: 0 }
    const plainest = [...candidates].sort((a, b) => a.name.length - b.name.length)[0]
    return { kind: 'catalog', product: plainest, rank: 0 }
  }
  const best = searchAll(items, name, 1)[0]
  return best && best.rank === 0 && n.length >= 3 ? best : null
}

/** Best guess of the shop section for an unknown name, from catalogue words in it. */
export function guessSection(name: string): SectionName | null {
  const n = norm(name)
  let best: { len: number; section: SectionName } | null = null
  for (const p of CATALOG) {
    for (const word of [p.name, ...(p.aliases ?? [])]) {
      const w = norm(word).replace(/\s*\(.*\)$/, '') // "paprika (raud)" → "paprika"
      if (w.length >= 3 && n.includes(w) && (!best || w.length > best.len)) best = { len: w.length, section: p.section }
    }
  }
  return best?.section ?? null
}

/** Capitalise the first letter, as the household's items are written. */
export function displayName(s: string): string {
  const t = s.trim()
  return t ? t[0].toLocaleUpperCase('nn') + t.slice(1) : t
}
