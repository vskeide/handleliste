'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ListItem } from '@/lib/types'

export function useRealtimeList(listId: string) {
  const [items, setItems] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchItems = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('list_items')
      .select('*')
      .eq('list_id', listId)
      .order('created_at')

    if (data) setItems(data)
    setLoading(false)
  }, [listId])

  useEffect(() => {
    fetchItems()

    const supabase = createClient()
    const channel = supabase
      .channel(`list-${listId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'list_items',
          filter: `list_id=eq.${listId}`,
        },
        (payload) => {
          switch (payload.eventType) {
            case 'INSERT':
              setItems((prev) => {
                // Avoid duplicates (if optimistic add already inserted it)
                if (prev.some((i) => i.id === (payload.new as ListItem).id)) {
                  return prev.map((i) =>
                    i.id === (payload.new as ListItem).id ? (payload.new as ListItem) : i
                  )
                }
                return [...prev, payload.new as ListItem]
              })
              break
            case 'UPDATE':
              setItems((prev) =>
                prev.map((i) =>
                  i.id === (payload.new as ListItem).id
                    ? (payload.new as ListItem)
                    : i
                )
              )
              break
            case 'DELETE':
              setItems((prev) =>
                prev.filter((i) => i.id !== (payload.old as { id: string }).id)
              )
              break
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [listId, fetchItems])

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

  return { items, loading, refetch: fetchItems, optimisticToggle, optimisticRemove }
}
