'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getListItems } from '@/lib/actions/lists'
import type { ListItem } from '@/lib/types'

// Live sync without giving the browser table access.
// The browser can no longer read tables (Row Level Security is on), so:
//  - list lines are loaded through a server action that checks ownership;
//  - after every change, the phone that made it sends a content-free "changed" ping
//    on a Realtime broadcast channel named after the list; other phones on the same
//    list refetch through the server action;
//  - as a fallback, the list refetches when the app comes back to the foreground
//    and every 20 s while visible.
const POLL_MS = 20_000

export function useRealtimeList(listId: string, initialLines?: ListItem[]) {
  const [items, setItems] = useState<ListItem[]>(initialLines ?? [])
  const [loading, setLoading] = useState(!initialLines)
  const channelRef = useRef<RealtimeChannel | null>(null)
  // Lines shown optimistically that the server hasn't confirmed yet. A refetch that
  // lands in between must not make them blink out.
  const pendingRef = useRef<Set<string>>(new Set())

  const fetchItems = useCallback(async () => {
    const data = (await getListItems(listId)) as ListItem[] | null
    if (data) {
      setItems((prev) => {
        const serverIds = new Set(data.map((d) => d.id))
        const stillPending = prev.filter((p) => pendingRef.current.has(p.id) && !serverIds.has(p.id))
        return [...data, ...stillPending]
      })
    }
    setLoading(false)
  }, [listId])

  useEffect(() => {
    if (!initialLines) fetchItems()

    const supabase = createClient()
    const channel = supabase
      .channel(`list:${listId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'changed' }, () => { fetchItems() })
      .subscribe()
    channelRef.current = channel

    const onVisible = () => { if (document.visibilityState === 'visible') fetchItems() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') fetchItems() }, POLL_MS)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
      channelRef.current = null
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialLines only matters on mount
  }, [listId, fetchItems])

  /** Tell the other phones on this list to refetch. Call after a write succeeds. */
  const notifyChanged = useCallback(() => {
    channelRef.current?.send({ type: 'broadcast', event: 'changed', payload: {} })
  }, [])

  // Optimistic update: toggle an item's checked state immediately
  const optimisticToggle = useCallback((itemId: string, isChecked: boolean) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, is_checked: isChecked, checked_at: isChecked ? new Date().toISOString() : null }
          : item
      )
    )
  }, [])

  // Optimistic update: remove an item immediately
  const optimisticRemove = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId))
  }, [])

  // Optimistic update: add an item immediately (mark it pending until confirmAdd)
  const optimisticAdd = useCallback((item: ListItem, pending = false) => {
    if (pending) pendingRef.current.add(item.id)
    setItems((prev) => {
      if (prev.some((i) => i.id === item.id)) return prev
      return [...prev, item]
    })
  }, [])

  /** The server stored the line: swap in the server row (its id may differ if it existed). */
  const confirmAdd = useCallback((clientId: string, row: ListItem) => {
    pendingRef.current.delete(clientId)
    setItems((prev) => {
      const without = prev.filter((i) => i.id !== clientId && i.id !== row.id)
      const at = prev.findIndex((i) => i.id === clientId)
      if (at < 0) return [...without, row]
      return [...without.slice(0, at), row, ...without.slice(at)]
    })
  }, [])

  // Optimistic update: update an item's quantity immediately
  const optimisticUpdateQuantity = useCallback((itemId: string, quantity: string) => {
    setItems((prev) =>
      prev.map((item) => item.id === itemId ? { ...item, quantity } : item)
    )
  }, [])

  /** Drop a line that the server refused (undo of an optimistic add). */
  const rollbackAdd = useCallback((clientId: string) => {
    pendingRef.current.delete(clientId)
    setItems((prev) => prev.filter((i) => i.id !== clientId))
  }, [])

  return {
    items,
    rollbackAdd,
    confirmAdd,
    loading,
    refetch: fetchItems,
    notifyChanged,
    optimisticToggle,
    optimisticRemove,
    optimisticUpdateQuantity,
    optimisticAdd,
  }
}
