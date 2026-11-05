'use client'

import { useEffect, useState } from 'react'
import { X, SkipForward, Undo2 } from 'lucide-react'
import { formatQuantityDisplay } from '@/components/quantity-picker-sheet'

export interface NextItemEntry {
  listItemId: string
  name: string
  quantity: string
  sectionName?: string
  sectionIcon?: string
  sectionColor?: string
}

interface Props {
  /** Unchecked items in walking order (same order as the list view). */
  items: NextItemEntry[]
  onPick: (listItemId: string) => void
  onUndo: (listItemId: string) => void
  onClose: () => void
}

/**
 * Fullscreen "next item" mode for the shop: one item at a time, tap anywhere to mark
 * it picked and show the next. Skip moves the item to the back of the queue.
 */
export function NextItemMode({ items, onPick, onUndo, onClose }: Props) {
  const [skipped, setSkipped] = useState<string[]>([])
  const [lastPicked, setLastPicked] = useState<NextItemEntry | null>(null)

  // Skipped items go last, in the order they were skipped
  const queue = [
    ...items.filter((i) => !skipped.includes(i.listItemId)),
    ...skipped.map((id) => items.find((i) => i.listItemId === id)).filter(Boolean) as NextItemEntry[],
  ]
  const current = queue[0]
  const next = queue[1]

  // Keep the screen on while shopping, where the browser supports it
  useEffect(() => {
    let lock: any = null
    const nav: any = navigator
    nav.wakeLock?.request('screen').then((l: any) => { lock = l }).catch(() => {})
    return () => { lock?.release?.().catch?.(() => {}) }
  }, [])

  function pick() {
    if (!current) return
    navigator.vibrate?.(30)
    setLastPicked(current)
    setSkipped((s) => s.filter((id) => id !== current.listItemId))
    onPick(current.listItemId)
  }

  function skip(e: React.MouseEvent) {
    e.stopPropagation()
    if (!current || queue.length < 2) return
    setSkipped((s) => [...s.filter((id) => id !== current.listItemId), current.listItemId])
  }

  function undo(e: React.MouseEvent) {
    e.stopPropagation()
    if (!lastPicked) return
    onUndo(lastPicked.listItemId)
    setLastPicked(null)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-white select-none"
      style={{ borderTop: `8px solid ${current?.sectionColor || '#10B981'}` }}
      onClick={pick}
    >
      <div className="flex items-center justify-between px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm text-[#64748B]">{queue.length} att</span>
        <button onClick={onClose} className="p-2 text-[#64748B]" aria-label="Lukk">
          <X className="h-6 w-6" />
        </button>
      </div>

      {current ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          {current.sectionName && (
            <p className="mb-4 text-lg text-[#64748B]">
              {current.sectionIcon} {current.sectionName}
            </p>
          )}
          <h2 className="text-5xl font-bold leading-tight text-[#0F172A] break-words">{current.name}</h2>
          {current.quantity !== '1' && (
            <p className="mt-4 text-3xl font-semibold text-[#059669]">{formatQuantityDisplay(current.quantity)}</p>
          )}
          <p className="mt-10 text-sm text-[#94A3B8]">Trykk for å plukke</p>
          {next && <p className="mt-2 text-sm text-[#94A3B8]">Neste: {next.name}</p>}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center" onClick={(e) => { e.stopPropagation(); onClose() }}>
          <p className="text-6xl">✅</p>
          <h2 className="mt-4 text-3xl font-bold text-[#0F172A]">Alt er plukka</h2>
          <p className="mt-2 text-sm text-[#94A3B8]">Trykk for å gå tilbake til lista</p>
        </div>
      )}

      <div className="flex items-center justify-between px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={undo}
          disabled={!lastPicked}
          className="flex items-center gap-2 rounded-full border px-4 py-3 text-sm text-[#64748B] disabled:opacity-30"
        >
          <Undo2 className="h-4 w-4" /> Angre
        </button>
        <button
          onClick={skip}
          disabled={!current || queue.length < 2}
          className="flex items-center gap-2 rounded-full border px-4 py-3 text-sm text-[#64748B] disabled:opacity-30"
        >
          Hopp over <SkipForward className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
