'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getListItems } from '@/lib/actions/lists'
import type { ListItem } from '@/lib/types'
import type { WriteResult } from '@/lib/list-outbox'

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
  const revision = useRef(0)
  const requestNumber = useRef(0)

  const fetchItems = useCallback(async () => {
    const started = revision.current
    const request = ++requestNumber.current
    let data: ListItem[] | null = null
    try {
      data = (await getListItems(listId)) as ListItem[] | null
    } catch {
      // Offline: keep what is on screen
    }
    if (data && started === revision.current && request === requestNumber.current) {
      try { localStorage.setItem(`handleliste-lines-${listId}`, JSON.stringify(data)) } catch {}
      setItems(data)
    }
    setLoading(false)
  }, [listId])

  useEffect(() => {
    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem(`handleliste-lines-${listId}`) || 'null')
        if (Array.isArray(cached) && cached.every(l => l && typeof l.id === 'string' && typeof l.item_id === 'string' && typeof l.quantity === 'string')) setItems(cached)
      } catch {}
    }
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

  const acceptWrite = useCallback((result: WriteResult) => {
    revision.current++
    setItems(prev => {
      const updated = new Map((result.lines ?? []).map(l => [l.id, l]))
      const next = prev.filter(l => l.id !== result.removed && !updated.has(l.id)).concat(Array.from(updated.values()))
      try { localStorage.setItem(`handleliste-lines-${listId}`, JSON.stringify(next)) } catch {}
      return next
    })
  }, [listId])

  return {
    acceptWrite,
    items,
    loading,
    refetch: fetchItems,
    notifyChanged,
  }
}
