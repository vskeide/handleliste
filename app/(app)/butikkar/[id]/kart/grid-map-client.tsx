'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { t } from '@/lib/i18n'
import { saveStoreMap } from '@/lib/actions/stores'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Eye, Pencil, Plus, Minus, GripVertical, Move } from 'lucide-react'
import type { Section, StoreMap, StoreMapBlock, WalkOrder } from '@/lib/types'

interface Props {
  storeId: string
  storeName: string
  sections: Section[]
  storeMap: StoreMap | null
  walkOrder: WalkOrder[]
  canEdit: boolean
}

const DEFAULT_GRID_COLS = 8
const DEFAULT_GRID_ROWS = 10

export function GridMapClient({ storeId, storeName, sections, storeMap, walkOrder, canEdit }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [blocks, setBlocks] = useState<StoreMapBlock[]>(storeMap?.blocks || [])
  const [gridCols] = useState(storeMap?.grid_cols || DEFAULT_GRID_COLS)
  const [gridRows] = useState(storeMap?.grid_rows || DEFAULT_GRID_ROWS)
  const [entrance, setEntrance] = useState(storeMap?.entrance_position || { col: 0, row: (storeMap?.grid_rows || DEFAULT_GRID_ROWS) - 1 })
  const [checkout, setCheckout] = useState(storeMap?.checkout_position || { col: (storeMap?.grid_cols || DEFAULT_GRID_COLS) - 1, row: (storeMap?.grid_rows || DEFAULT_GRID_ROWS) - 1 })
  const [saving, setSaving] = useState(false)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [placingEntrance, setPlacingEntrance] = useState(false)
  const [placingCheckout, setPlacingCheckout] = useState(false)
  // Drag state for moving tiles
  const [draggingBlock, setDraggingBlock] = useState<number | null>(null)
  const [dragOffset, setDragOffset] = useState({ col: 0, row: 0 })
  const gridRef = useRef<HTMLDivElement>(null)

  const sectionMap: Record<string, Section> = {}
  sections.forEach((s) => { sectionMap[s.id] = s })
  const walkOrderMap: Record<string, number> = {}
  walkOrder.forEach((wo) => { walkOrderMap[wo.section_id] = wo.walk_order })

  // Collision detection: can a block be placed at col,row with given size?
  function canPlace(col: number, row: number, w: number, h: number, excludeIndex?: number): boolean {
    if (col < 0 || row < 0 || col + w > gridCols || row + h > gridRows) return false
    for (let i = 0; i < blocks.length; i++) {
      if (i === excludeIndex) continue
      const b = blocks[i]
      if (col < b.col + b.width && col + w > b.col && row < b.row + b.height && row + h > b.row) {
        return false
      }
    }
    return true
  }

  function handleCellClick(col: number, row: number) {
    if (mode !== 'edit') return

    if (placingEntrance) {
      setEntrance({ col, row })
      setPlacingEntrance(false)
      return
    }
    if (placingCheckout) {
      setCheckout({ col, row })
      setPlacingCheckout(false)
      return
    }

    // Check if clicked on existing block
    const blockIdx = blocks.findIndex((b) =>
      col >= b.col && col < b.col + b.width && row >= b.row && row < b.row + b.height
    )

    if (blockIdx !== -1) {
      // Select existing block for info - no action in simple click
      return
    }

    if (selectedSection && canPlace(col, row, 1, 1)) {
      setBlocks((prev) => [...prev, { section_id: selectedSection, col, row, width: 1, height: 1 }])
    }
  }

  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index))
  }

  function resizeBlock(index: number, dw: number, dh: number) {
    setBlocks((prev) => {
      const b = prev[index]
      const newW = Math.max(1, b.width + dw)
      const newH = Math.max(1, b.height + dh)
      if (canPlace(b.col, b.row, newW, newH, index)) {
        const updated = [...prev]
        updated[index] = { ...b, width: newW, height: newH }
        return updated
      }
      return prev
    })
  }

  // Touch/pointer drag for moving blocks
  function startDrag(index: number, clientX: number, clientY: number) {
    if (mode !== 'edit' || !gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    const cellW = rect.width / gridCols
    const cellH = rect.height / gridRows
    const gridCol = Math.floor((clientX - rect.left) / cellW)
    const gridRow = Math.floor((clientY - rect.top) / cellH)
    const b = blocks[index]
    setDraggingBlock(index)
    setDragOffset({ col: gridCol - b.col, row: gridRow - b.row })
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (draggingBlock === null || !gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    const cellW = rect.width / gridCols
    const cellH = rect.height / gridRows
    const gridCol = Math.floor((e.clientX - rect.left) / cellW) - dragOffset.col
    const gridRow = Math.floor((e.clientY - rect.top) / cellH) - dragOffset.row
    const b = blocks[draggingBlock]
    if (canPlace(gridCol, gridRow, b.width, b.height, draggingBlock)) {
      setBlocks((prev) => {
        const updated = [...prev]
        updated[draggingBlock] = { ...b, col: gridCol, row: gridRow }
        return updated
      })
    }
  }

  function handlePointerUp() {
    setDraggingBlock(null)
  }

  async function handleSave() {
    setSaving(true)
    await saveStoreMap(storeId, {
      grid_cols: gridCols,
      grid_rows: gridRows,
      entrance_position: entrance,
      checkout_position: checkout,
      blocks,
    })
    setSaving(false)
    setMode('view')
  }

  // Determine which sections are already placed
  const placedSectionIds = new Set(blocks.map((b) => b.section_id))

  return (
    <div className="mx-auto max-w-lg px-4 pt-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/butikkar/${storeId}`} className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-[#0F172A]">{t('map.title')}</h1>
          <p className="text-xs text-[#64748B]">{storeName}</p>
        </div>
        {canEdit && (
          <div className="flex rounded-lg border overflow-hidden">
            <button
              onClick={() => setMode('view')}
              className={`px-3 py-1.5 text-xs font-medium ${
                mode === 'view' ? 'bg-primary text-white' : 'bg-white text-[#64748B]'
              }`}
            >
              <Eye className="h-3.5 w-3.5 inline mr-1" />
              {t('map.view')}
            </button>
            <button
              onClick={() => setMode('edit')}
              className={`px-3 py-1.5 text-xs font-medium ${
                mode === 'edit' ? 'bg-primary text-white' : 'bg-white text-[#64748B]'
              }`}
            >
              <Pencil className="h-3.5 w-3.5 inline mr-1" />
              {t('map.edit')}
            </button>
          </div>
        )}
      </div>

      {/* Edit toolbar: entrance/checkout placement */}
      {mode === 'edit' && (
        <div className="mb-3 space-y-2">
          {/* Entrance / Checkout buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => { setPlacingEntrance(true); setPlacingCheckout(false); setSelectedSection(null) }}
              className={`flex-1 flex items-center justify-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors ${
                placingEntrance ? 'ring-2 ring-primary bg-primary/5' : 'bg-white'
              }`}
            >
              🚪 Plasser inngang
            </button>
            <button
              onClick={() => { setPlacingCheckout(true); setPlacingEntrance(false); setSelectedSection(null) }}
              className={`flex-1 flex items-center justify-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors ${
                placingCheckout ? 'ring-2 ring-primary bg-primary/5' : 'bg-white'
              }`}
            >
              💳 Plasser kasse
            </button>
          </div>

          {/* Section palette */}
          <div className="flex flex-wrap gap-1.5 p-2 bg-white rounded-lg border">
            {sections.map((section) => {
              const placed = placedSectionIds.has(section.id)
              return (
                <button
                  key={section.id}
                  onClick={() => {
                    setSelectedSection(selectedSection === section.id ? null : section.id)
                    setPlacingEntrance(false)
                    setPlacingCheckout(false)
                  }}
                  disabled={placed}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    placed
                      ? 'opacity-30 cursor-not-allowed'
                      : selectedSection === section.id
                        ? 'ring-2 ring-offset-1 ring-primary scale-105'
                        : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: section.color + '20',
                    color: section.color,
                  }}
                >
                  <span>{section.icon}</span>
                  <span className="hidden sm:inline">{section.name_nn}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!canEdit && mode === 'view' && (
        <p className="text-xs text-[#94A3B8] mb-3 text-center">{t('map.no_permission')}</p>
      )}

      {/* Grid map */}
      <div
        ref={gridRef}
        className="relative bg-[#F1F5F9] rounded-lg border overflow-hidden"
        style={{
          aspectRatio: `${gridCols}/${gridRows}`,
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
          {Array.from({ length: gridCols + 1 }, (_, i) => (
            <line
              key={`v-${i}`}
              x1={`${(i / gridCols) * 100}%`}
              y1="0"
              x2={`${(i / gridCols) * 100}%`}
              y2="100%"
              stroke="#E2E8F0"
              strokeWidth="1"
            />
          ))}
          {Array.from({ length: gridRows + 1 }, (_, i) => (
            <line
              key={`h-${i}`}
              x1="0"
              y1={`${(i / gridRows) * 100}%`}
              x2="100%"
              y2={`${(i / gridRows) * 100}%`}
              stroke="#E2E8F0"
              strokeWidth="1"
            />
          ))}
        </svg>

        {/* Click catcher for empty cells */}
        {mode === 'edit' && (
          <div className="absolute inset-0" style={{ zIndex: 2 }}>
            {Array.from({ length: gridRows }, (_, row) =>
              Array.from({ length: gridCols }, (_, col) => (
                <div
                  key={`cell-${col}-${row}`}
                  className="absolute cursor-pointer hover:bg-primary/5"
                  style={{
                    left: `${(col / gridCols) * 100}%`,
                    top: `${(row / gridRows) * 100}%`,
                    width: `${(1 / gridCols) * 100}%`,
                    height: `${(1 / gridRows) * 100}%`,
                  }}
                  onClick={() => handleCellClick(col, row)}
                />
              ))
            )}
          </div>
        )}

        {/* Section tiles */}
        {blocks.map((block, index) => {
          const section = sectionMap[block.section_id]
          if (!section) return null
          const walkNum = walkOrderMap[block.section_id]
          return (
            <div
              key={`block-${index}`}
              className={`absolute flex flex-col items-center justify-center rounded-md shadow-sm ${
                mode === 'edit' ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
              style={{
                left: `${(block.col / gridCols) * 100}%`,
                top: `${(block.row / gridRows) * 100}%`,
                width: `${(block.width / gridCols) * 100}%`,
                height: `${(block.height / gridRows) * 100}%`,
                backgroundColor: section.color + 'CC',
                zIndex: draggingBlock === index ? 20 : 5,
                transition: draggingBlock === index ? 'none' : 'all 0.15s ease',
              }}
              onPointerDown={(e) => {
                if (mode === 'edit' && !placingEntrance && !placingCheckout) {
                  e.preventDefault()
                  startDrag(index, e.clientX, e.clientY)
                }
              }}
              onClick={() => {
                if (mode === 'edit' && placingEntrance) {
                  // Don't place entrance on a tile
                } else if (mode === 'edit' && placingCheckout) {
                  // Don't place checkout on a tile
                }
              }}
            >
              {walkNum !== undefined && (
                <div
                  className="absolute top-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/90 text-[8px] font-bold"
                  style={{ color: section.color }}
                >
                  {walkNum}
                </div>
              )}
              <span className="text-base">{section.icon}</span>
              {(block.width >= 2 || block.height >= 2) && (
                <span className="text-[9px] text-white font-semibold leading-tight text-center truncate max-w-full px-1">
                  {section.name_nn}
                </span>
              )}

              {/* Resize / remove controls in edit mode */}
              {mode === 'edit' && (
                <div className="absolute -bottom-0.5 -right-0.5 flex gap-0.5" style={{ zIndex: 10 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); resizeBlock(index, 1, 0) }}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-white shadow text-[10px] text-[#64748B] hover:text-primary"
                    title="Breiare"
                  >
                    →
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); resizeBlock(index, 0, 1) }}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-white shadow text-[10px] text-[#64748B] hover:text-primary"
                    title="Høgare"
                  >
                    ↓
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); resizeBlock(index, -1, 0) }}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-white shadow text-[10px] text-[#64748B] hover:text-primary"
                    title="Smalare"
                  >
                    ←
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); resizeBlock(index, 0, -1) }}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-white shadow text-[10px] text-[#64748B] hover:text-primary"
                    title="Lågare"
                  >
                    ↑
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeBlock(index) }}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 shadow text-white text-[10px]"
                    title="Fjern"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {/* Entrance marker */}
        <div
          className="absolute flex items-center justify-center pointer-events-none"
          style={{
            left: `${(entrance.col / gridCols) * 100}%`,
            top: `${(entrance.row / gridRows) * 100}%`,
            width: `${(1 / gridCols) * 100}%`,
            height: `${(1 / gridRows) * 100}%`,
            zIndex: 15,
          }}
        >
          <span className="text-lg drop-shadow-md">🚪</span>
        </div>

        {/* Checkout marker */}
        <div
          className="absolute flex items-center justify-center pointer-events-none"
          style={{
            left: `${(checkout.col / gridCols) * 100}%`,
            top: `${(checkout.row / gridRows) * 100}%`,
            width: `${(1 / gridCols) * 100}%`,
            height: `${(1 / gridRows) * 100}%`,
            zIndex: 15,
          }}
        >
          <span className="text-lg drop-shadow-md">💳</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-3 text-xs text-[#94A3B8]">
        <span>🚪 {t('map.entrance')} · 💳 {t('map.checkout')}</span>
        <span suppressHydrationWarning>{blocks.length} seksjonar plasserte</span>
      </div>

      {/* Section list below map */}
      <div className="mt-4 space-y-1">
        {blocks
          .sort((a, b) => (walkOrderMap[a.section_id] ?? 999) - (walkOrderMap[b.section_id] ?? 999))
          .map((block, idx) => {
            const section = sectionMap[block.section_id]
            if (!section) return null
            const walkNum = walkOrderMap[block.section_id]
            return (
              <div key={idx} className="flex items-center gap-2 rounded-lg p-2 bg-white border border-[#E2E8F0]">
                <span
                  className="flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: section.color }}
                >
                  {walkNum}
                </span>
                <span className="text-sm">{section.icon}</span>
                <span className="text-sm font-medium text-[#0F172A]">{section.name_nn}</span>
                <span className="text-[10px] text-[#94A3B8] ml-auto">
                  {block.width}×{block.height}
                </span>
              </div>
            )
          })}
      </div>

      {/* Save button (edit mode) */}
      {mode === 'edit' && (
        <div className="fixed bottom-20 left-0 right-0 px-4">
          <div className="mx-auto max-w-lg">
            <Button onClick={handleSave} className="w-full h-12" disabled={saving}>
              {saving ? 'Lagrar...' : t('map.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
