'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Writes made with no signal (in the shop basement, say) are kept on the phone and sent
// when the connection is back, in the order they were made.
//
// Only network failures are queued. A server that answers with an error is a real
// refusal and is handled by the caller as before.

export type OutboxOp =
  | { kind: 'add'; clientId: string; itemId: string; quantity?: string }
  | { kind: 'create'; clientId: string; itemId: string; name: string; sectionId: string; quantity?: string; confirmed?: boolean }
  | { kind: 'toggle'; listItemId: string; checked: boolean }
  | { kind: 'qty'; listItemId: string; quantity: string }
  | { kind: 'remove'; listItemId: string }

type Runner = (op: OutboxOp) => Promise<unknown>

function storageKey(listId: string) {
  return `handleliste-outbox-${listId}`
}

function load(listId: string): OutboxOp[] {
  try {
    const raw = localStorage.getItem(storageKey(listId))
    return raw ? (JSON.parse(raw) as OutboxOp[]) : []
  } catch {
    return []
  }
}

function save(listId: string, ops: OutboxOp[]) {
  try {
    if (ops.length) localStorage.setItem(storageKey(listId), JSON.stringify(ops))
    else localStorage.removeItem(storageKey(listId))
  } catch {
    // Storage unavailable (private mode): the queue then lives only in memory
  }
}

/** True for "could not reach the server", as opposed to the server saying no. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = e instanceof Error ? e.message : String(e)
  return e instanceof TypeError || /fetch|network|load failed|offline/i.test(msg)
}

/**
 * @param run      sends one op to the server; resolves with the server's answer
 * @param onSent   called for each op once the server has answered (to confirm adds)
 * @param onDrained called after the queue empties (refetch, ping the other phone)
 */
export function useOutbox(
  listId: string,
  run: Runner,
  onSent: (op: OutboxOp, result: unknown) => void,
  onDrained: () => void,
) {
  const queueRef = useRef<OutboxOp[]>([])
  const [waiting, setWaiting] = useState(0)
  const flushing = useRef(false)
  const runRef = useRef(run)
  const sentRef = useRef(onSent)
  const drainedRef = useRef(onDrained)
  runRef.current = run
  sentRef.current = onSent
  drainedRef.current = onDrained

  const persist = useCallback(() => {
    save(listId, queueRef.current)
    setWaiting(queueRef.current.length)
  }, [listId])

  const flush = useCallback(async () => {
    if (flushing.current || queueRef.current.length === 0) return
    flushing.current = true
    try {
      while (queueRef.current.length > 0) {
        const op = queueRef.current[0]
        let result: unknown
        try {
          result = await runRef.current(op)
        } catch (e) {
          if (isNetworkError(e)) return // still offline: try again later
          result = { error: 'Kunne ikkje lagre' }
        }
        queueRef.current = queueRef.current.slice(1)
        persist()
        sentRef.current(op, result)
      }
      drainedRef.current()
    } finally {
      flushing.current = false
    }
  }, [persist])

  /** Put an op in the queue (after a network failure) and try again soon. */
  const enqueue = useCallback((op: OutboxOp) => {
    queueRef.current = [...queueRef.current, op]
    persist()
  }, [persist])

  // Restore a queue left from an earlier visit, and retry whenever we may be online
  useEffect(() => {
    queueRef.current = load(listId)
    setWaiting(queueRef.current.length)
    const tryNow = () => { void flush() }
    window.addEventListener('online', tryNow)
    document.addEventListener('visibilitychange', tryNow)
    const timer = setInterval(tryNow, 15_000)
    tryNow()
    return () => {
      window.removeEventListener('online', tryNow)
      document.removeEventListener('visibilitychange', tryNow)
      clearInterval(timer)
    }
  }, [listId, flush])

  /** Ops restored from storage, so the screen can show them before they are sent. */
  const queued = useCallback(() => queueRef.current, [])

  return { enqueue, flush, waiting, queued }
}
