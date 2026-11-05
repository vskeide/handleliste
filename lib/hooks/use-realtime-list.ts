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

export function useRealtimeList(listId: string) {
  const [items, setItems] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<RealtimeChannel | null>(null)

  const fetchItems = useCallback(async () => {
    const data = await getListItems(listId)
    if (data) setItems(data as ListItem[])
    setLoading(false)
  }, [listId])

  useEffect(() => {
    fetchItems()

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

  // Optimistic update: add an item immediately
  const optimisticAdd = useCallback((item: ListItem) => {
    setItems((prev) => {
      if (prev.some((i) => i.id === item.id)) return prev
      return [...prev, item]
    })
  }, [])

  // Optimistic update: update an item's quantity immediately
  const optimisticUpdateQuantity = useCallback((itemId: string, quantity: string) => {
    setItems((prev) =>
      prev.map((item) => item.id === itemId ? { ...item, quantity } : item)
    )
  }, [])

  return {
    items,
    loading,
    refetch: fetchItems,
    notifyChanged,
    optimisticToggle,
    optimisticRemove,
    optimisticUpdateQuantity,
    optimisticAdd,
  }
}
