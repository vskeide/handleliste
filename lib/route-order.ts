// Learn only "A before B". An unpicked product never gets an invented position.
export interface RoutePair { a_id: string; b_id: string; a_before_b: number; n: number }
export interface RouteRank { avg: number; n: number }

export function combineRoutePairs(rows: RoutePair[]): RoutePair[] {
  const grouped = new Map<string, RoutePair>()
  for (const r of rows) {
    const key = `${r.a_id}:${r.b_id}`
    const previous = grouped.get(key)
    const weight = Math.min(r.n, 8)
    if (!previous) grouped.set(key, { ...r, n: weight })
    else {
      previous.a_before_b = (previous.a_before_b * previous.n + r.a_before_b * weight) / (previous.n + weight)
      previous.n += weight
    }
  }
  return Array.from(grouped.values())
}

/** Stable topological order; manual layout/name order breaks ties and uncertain cycles. */
export function routeRanks(fallbackOrder: string[], pairs: RoutePair[]): Record<string, RouteRank> {
  const fallback = new Map(fallbackOrder.map((id, i) => [id, i]))
  const remaining = new Set(fallbackOrder)
  const incoming = new Map(fallbackOrder.map(id => [id, new Set<string>()]))
  const outgoing = new Map(fallbackOrder.map(id => [id, new Set<string>()]))
  const observations = new Map<string, number>()
  const strength = new Map<string, number>()
  for (const p of pairs) {
    if (!remaining.has(p.a_id) || !remaining.has(p.b_id) || p.a_id === p.b_id || p.n < 1) continue
    if (p.a_before_b > 0.4 && p.a_before_b < 0.6) continue
    const before = p.a_before_b >= 0.6 ? p.a_id : p.b_id
    const after = before === p.a_id ? p.b_id : p.a_id
    incoming.get(after)!.add(before); outgoing.get(before)!.add(after)
    strength.set(`${before}:${after}`, Math.abs(p.a_before_b - 0.5) * 2 * Math.min(p.n,8))
    for (const id of [before, after]) observations.set(id, Math.max(observations.get(id) ?? 0, p.n))
  }
  const ordered: string[] = []
  while (remaining.size) {
    const candidates = Array.from(remaining).filter(id => incoming.get(id)!.size === 0)
    // Contradictory trips can form a cycle. Break its weakest net ordering, predictably.
    const net = (id: string) => Array.from(outgoing.get(id)!).reduce((sum,to) => sum+(strength.get(`${id}:${to}`)??0),0)
      - Array.from(incoming.get(id)!).reduce((sum,from) => sum+(strength.get(`${from}:${id}`)??0),0)
    const choices = candidates.length ? candidates : Array.from(remaining).sort((a, b) =>
      net(b) - net(a)
      || fallback.get(a)! - fallback.get(b)!)
    const next = candidates.length ? choices.sort((a,b) => fallback.get(a)! - fallback.get(b)!)[0] : choices[0]
    ordered.push(next); remaining.delete(next)
    for (const after of outgoing.get(next)!) incoming.get(after)!.delete(next)
    for (const before of incoming.get(next)!) outgoing.get(before)!.delete(next)
  }
  const ranks: Record<string, RouteRank> = {}
  ordered.forEach((id, i) => {
    if (observations.has(id)) ranks[id] = { avg: i / Math.max(1, ordered.length - 1), n: observations.get(id)! }
  })
  return ranks
}
