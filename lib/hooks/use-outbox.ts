'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ListOutbox, type OutboxOp, type PendingWrite, type WriteResult } from '@/lib/list-outbox'
export type { OutboxOp } from '@/lib/list-outbox'

export function useOutbox(listId: string, run: (write: PendingWrite) => Promise<WriteResult>,
  onSent: (write: PendingWrite, result: WriteResult) => void, onDrained: () => void) {
  const queue = useRef<ListOutbox | null>(null)
  const [, render] = useState(0)
  const callbacks = useRef({ run, onSent, onDrained })
  callbacks.current = { run, onSent, onDrained }
  const flush = useCallback(() => queue.current?.flush(w => callbacks.current.run(w),
    (w, r) => callbacks.current.onSent(w, r), () => callbacks.current.onDrained()), [])
  useEffect(() => {
    const engine = new ListOutbox(`handleliste-outbox-${listId}`, localStorage, () => render(n => n + 1))
    queue.current = engine
    engine.restore()
    const tryNow = () => { if (document.visibilityState === 'visible' && navigator.onLine) void flush() }
    window.addEventListener('online', tryNow)
    document.addEventListener('visibilitychange', tryNow)
    const timer = setInterval(tryNow, 15_000)
    tryNow()
    return () => {
      engine.stop(); queue.current = null
      window.removeEventListener('online', tryNow)
      document.removeEventListener('visibilitychange', tryNow)
      clearInterval(timer)
    }
  }, [listId, flush])
  const enqueue = (op: OutboxOp) => { queue.current?.enqueue(op); if (navigator.onLine) void flush() }
  const retry = () => { queue.current?.retry(); void flush() }
  const discard = () => { queue.current?.discard(); callbacks.current.onDrained() }
  return { enqueue, retry, discard, pending: queue.current?.entries ?? [], waiting: queue.current?.entries.length ?? 0, error: queue.current?.error ?? null }
}
