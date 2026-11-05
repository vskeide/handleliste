import type { ListItem } from './types'

export interface BatchLine {
  clientId: string; itemId: string; quantity: string
  create?: boolean; name?: string; sectionId?: string; confirmed?: boolean; optimisticQuantity?: string
}
export type OutboxOp =
  | { kind: 'add'; clientId: string; itemId: string; quantity?: string; name?: string; sectionId?: string | null }
  | { kind: 'create'; clientId: string; itemId: string; name: string; sectionId: string; quantity?: string; confirmed?: boolean }
  | { kind: 'toggle'; listItemId: string; checked: boolean; record?: boolean }
  | { kind: 'qty'; listItemId: string; quantity: string }
  | { kind: 'remove'; listItemId: string }
  | { kind: 'batch'; lines: BatchLine[] }
  | { kind: 'uncheck' }
  | { kind: 'copy' }
export interface PendingWrite { id: string; op: OutboxOp }
export interface WriteResult {
  error?: string; aliases?: Record<string, string>
  lines?: ListItem[]; removed?: string
  items?: { id: string; name: string; section_id: string | null; is_confirmed: boolean; times_purchased: number }[]
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

function validOperation(op: unknown): op is OutboxOp {
  if (!op || typeof op !== 'object' || !('kind' in op)) return false
  const value = op as Record<string, unknown>
  if (value.kind === 'uncheck' || value.kind === 'copy') return true
  if (value.kind === 'batch') return Array.isArray(value.lines) && value.lines.length <= 100 && value.lines.every(l => l && typeof l.itemId === 'string' && typeof l.clientId === 'string' && typeof l.quantity === 'string')
  if (value.kind === 'add' || value.kind === 'create') return typeof value.itemId === 'string' && typeof value.clientId === 'string'
  if (value.kind === 'remove') return typeof value.listItemId === 'string'
  if (value.kind === 'qty') return typeof value.listItemId === 'string' && typeof value.quantity === 'string'
  if (value.kind === 'toggle') return typeof value.listItemId === 'string' && typeof value.checked === 'boolean'
  return false
}

export function remapOperation(op: OutboxOp, aliases: Record<string, string>): OutboxOp {
  if ('listItemId' in op) return { ...op, listItemId: aliases[op.listItemId] ?? op.listItemId }
  if (op.kind === 'add') return { ...op, itemId: aliases[op.itemId] ?? op.itemId }
  if (op.kind === 'create') return { ...op, itemId: aliases[op.itemId] ?? op.itemId, clientId: aliases[op.clientId] ?? op.clientId }
  if (op.kind === 'batch') return { ...op, lines: op.lines.map(l => ({ ...l, itemId: aliases[l.itemId] ?? l.itemId, clientId: aliases[l.clientId] ?? l.clientId })) }
  return op
}

// Overlay all unsent changes after every server refresh, including removals.
export function overlayWrites(lines: ListItem[], writes: PendingWrite[], listId: string): ListItem[] {
  let result = lines.map(l => ({ ...l }))
  const add = (line: BatchLine) => {
    const existing = result.find(l => l.item_id === line.itemId || l.id === line.clientId)
    if (existing) {
      // A polling read may already include a committed-but-unacknowledged add.
      // Keep absolute local edits; do not add a batch's quantity a second time here.
      if (line.optimisticQuantity) existing.quantity = line.optimisticQuantity
      if (existing.is_checked) { existing.is_checked = false; existing.checked_at = null; existing.quantity = line.optimisticQuantity ?? line.quantity }
      return
    }
    result.push({ id: line.clientId, list_id: listId, item_id: line.itemId, quantity: line.quantity,
      is_checked: false, checked_at: null, sort_override: null, created_at: new Date(0).toISOString() })
  }
  for (const { op } of writes) {
    if (op.kind === 'add' || op.kind === 'create') add({ ...op, sectionId: op.sectionId ?? undefined, quantity: op.quantity ?? '1' })
    else if (op.kind === 'batch') op.lines.forEach(line => add(line))
    else if (op.kind === 'uncheck') result.forEach(l => { l.is_checked = false; l.checked_at = null })
    else if (op.kind === 'remove') result = result.filter(l => l.id !== op.listItemId)
    else if (op.kind === 'qty' || op.kind === 'toggle') for (const l of result) if (l.id === op.listItemId) {
      if (op.kind === 'qty') l.quantity = op.quantity
      else { l.is_checked = op.checked; l.checked_at = op.checked ? l.checked_at ?? new Date(0).toISOString() : null }
    }
  }
  return result
}

/** A single durable queue for online and offline writes. Receipts make retries safe. */
export class ListOutbox {
  entries: PendingWrite[] = []
  error: string | null = null
  private busy = false
  private active = true
  private aliases: Record<string, string> = {}
  constructor(private key: string, private storage: Storage, private changed: () => void) {}
  restore() {
    try {
      const raw = this.storage.getItem(this.key)
      if (!raw) return
      const saved: unknown = JSON.parse(raw)
      if (!Array.isArray(saved) || saved.some(w => !w || typeof w !== 'object' || !validOperation('op' in w ? w.op : w))) throw new Error()
      // Import the previous queue format once, retaining stable request IDs thereafter.
      this.entries = saved.map(w => 'op' in w ? w : { id: crypto.randomUUID(), op: w })
      this.persist()
    } catch { this.error = 'Kunne ikkje lese venta endringar. Forkast dei for å hente lista på nytt.'; this.changed() }
  }
  private persist() {
    try {
      if (this.entries.length) this.storage.setItem(this.key, JSON.stringify(this.entries))
      else this.storage.removeItem(this.key)
    } catch { this.error = 'Lagring på telefonen er full. Hald sida open og prøv igjen.' }
    this.changed()
  }
  enqueue(op: OutboxOp) { this.entries = [...this.entries, { id: crypto.randomUUID(), op: remapOperation(op, this.aliases) }]; this.persist() }
  stop() { this.active = false }
  discard() { if (this.busy) return; this.entries = []; this.error = null; this.persist() }
  async flush(run: (write: PendingWrite) => Promise<WriteResult>, onSent: (write: PendingWrite, result: WriteResult) => void, drained: () => void) {
    if (this.busy || !this.active || !this.entries.length || this.error) return
    this.busy = true
    try {
      while (this.active && this.entries.length && !this.error) {
        const write = this.entries[0]
        let result: WriteResult
        try { result = await run(write) }
        catch { return } // Keep the persisted operation; retry with the exact same ID.
        if (result.error) { this.error = result.error; this.changed(); return }
        if (!this.active) return
        this.aliases = { ...this.aliases, ...result.aliases }
        this.entries = this.entries.slice(1).map(w => ({ ...w, op: remapOperation(w.op, result.aliases ?? {}) }))
        this.persist()
        onSent(write, result)
      }
      if (this.active) drained()
    } finally { this.busy = false; this.changed() }
  }
  retry() { this.error = null; this.persist() }
}
