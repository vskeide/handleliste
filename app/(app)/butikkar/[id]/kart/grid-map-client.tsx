'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { t } from '@/lib/i18n'
import { saveStoreMap } from '@/lib/actions/stores'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Eye, Pencil, Trash2 } from 'lucide-react'
import type { Section, StoreMap, StoreMapBlock, WalkOrder } from '@/lib/types'

interface Props {
  storeId: string
  storeName: string
  sections: Section[]
  storeMap: StoreMap | null
  walkOrder: WalkOrder[]
  canEdit: boolean
}

// Doubled 2026-11-05 (was 8×10) for finer shop layouts. Existing maps keep their own size.
const DEFAULT_GRID_COLS = 16
const DEFAULT_GRID_ROWS = 20
// Smallest grab zone for the resize edges, so they stay usable with small cells on a phone
const MIN_EDGE_PX = 10

type DragMode = 'move' | 'resize-right' | 'resize-bottom' | null

export function GridMapClient({ storeId, storeName, sections, storeMap, walkOrder, canEdit }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [zoom, setZoom] = useState(1)
  const [panning, setPanning] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const editing = mode === 'edit' && !panning
  const [blocks, setBlocks] = useState<StoreMapBlock[]>(storeMap?.blocks || [])
  const [gridCols] = useState(storeMap?.grid_cols || DEFAULT_GRID_COLS)
  const [gridRows] = useState(storeMap?.grid_rows || DEFAULT_GRID_ROWS)
  const [entrance, setEntrance] = useState(storeMap?.entrance_position || { col: 0, row: (storeMap?.grid_rows || DEFAULT_GRID_ROWS) - 1 })
  const [checkout, setCheckout] = useState(storeMap?.checkout_position || { col: (storeMap?.grid_cols || DEFAULT_GRID_COLS) - 1, row: (storeMap?.grid_rows || DEFAULT_GRID_ROWS) - 1 })
  const [saving, setSaving] = useState(false)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [placingEntrance, setPlacingEntrance] = useState(false)
  const [placingCheckout, setPlacingCheckout] = useState(false)

  // Drag state for tiles
  const [draggingBlock, setDraggingBlock] = useState<number | null>(null)
  const [dragMode, setDragMode] = useState<DragMode>(null)
  const [dragOffset, setDragOffset] = useState({ col: 0, row: 0 })
  const resizeStartRef = useRef<{ clientX: number; clientY: number; block: StoreMapBlock } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Cell selection state (drag to select a rectangle of empty cells)
  const [selectingFrom, setSelectingFrom] = useState<{ col: number; row: number } | null>(null)
  const [cellSelection, setCellSelection] = useState<{ col: number; row: number; w: number; h: number } | null>(null)

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

  /** Grid cell under a screen point, or null if outside the grid. */
  function cellAt(clientX: number, clientY: number): { col: number; row: number } | null {
    if (!gridRef.current) return null
    const rect = gridRef.current.getBoundingClientRect()
    const col = Math.floor(((clientX - rect.left) / rect.width) * gridCols)
    const row = Math.floor(((clientY - rect.top) / rect.height) * gridRows)
    if (col < 0 || row < 0 || col >= gridCols || row >= gridRows) return null
    return { col, row }
  }

  function handleCellPointerDown(col: number, row: number) {
    if (!editing) return

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

    // Start cell selection
    setSelectingFrom({ col, row })
    setCellSelection({ col, row, w: 1, h: 1 })
  }

  function handleCellPointerEnter(col: number, row: number) {
    if (!selectingFrom) return
    const minCol = Math.min(selectingFrom.col, col)
    const minRow = Math.min(selectingFrom.row, row)
    const maxCol = Math.max(selectingFrom.col, col)
    const maxRow = Math.max(selectingFrom.row, row)
    const w = maxCol - minCol + 1
    const h = maxRow - minRow + 1
    if (canPlace(minCol, minRow, w, h)) {
      setCellSelection({ col: minCol, row: minRow, w, h })
    }
  }

  function finalizeCellSelection() {
    if (!selectingFrom) return
    setSelectingFrom(null)
    // If a section is already selected and we have a valid selection, place immediately
    if (selectedSection && cellSelection && canPlace(cellSelection.col, cellSelection.row, cellSelection.w, cellSelection.h)) {
      setBlocks((prev) => [...prev, {
        section_id: selectedSection,
        col: cellSelection.col,
        row: cellSelection.row,
        width: cellSelection.w,
        height: cellSelection.h,
      }])
      setCellSelection(null)
      setSelectedSection(null)
    }
    // Otherwise keep the selection visible — user picks a section next
  }

  function placeAtSelection(sectionId: string) {
    if (!cellSelection) return
    if (canPlace(cellSelection.col, cellSelection.row, cellSelection.w, cellSelection.h)) {
      setBlocks((prev) => [...prev, {
        section_id: sectionId,
        col: cellSelection.col,
        row: cellSelection.row,
        width: cellSelection.w,
        height: cellSelection.h,
      }])
    }
    setCellSelection(null)
    setSelectedSection(null)
  }

  function removeBlock(index: number, e: React.PointerEvent | React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    setBlocks((prev) => prev.filter((_, i) => i !== index))
  }

  // Determine drag mode based on pointer position within tile
  function onTilePointerDown(index: number, e: React.PointerEvent) {
    if (!editing || !gridRef.current || placingEntrance || placingCheckout) return
    e.preventDefault()
    e.stopPropagation()

    const rect = gridRef.current.getBoundingClientRect()
    const cellW = rect.width / gridCols
    const cellH = rect.height / gridRows
    const b = blocks[index]

    // Calculate pointer position relative to the tile
    const tileLeft = rect.left + b.col * cellW
    const tileTop = rect.top + b.row * cellH
    const tileWidth = b.width * cellW
    const tileHeight = b.height * cellH

    const relX = e.clientX - tileLeft
    const relY = e.clientY - tileTop

    // Edge threshold: 30% of a single cell width/height (from the edge)
    const edgeThresholdX = Math.min(tileWidth / 3, Math.max(cellW * 0.35, MIN_EDGE_PX))
    const edgeThresholdY = Math.min(tileHeight / 3, Math.max(cellH * 0.35, MIN_EDGE_PX))

    const nearRight = relX > tileWidth - edgeThresholdX
    const nearBottom = relY > tileHeight - edgeThresholdY

    if (nearRight && !nearBottom) {
      // Resize right edge
      setDraggingBlock(index)
      setDragMode('resize-right')
      resizeStartRef.current = { clientX: e.clientX, clientY: e.clientY, block: { ...b } }
    } else if (nearBottom && !nearRight) {
      // Resize bottom edge
      setDraggingBlock(index)
      setDragMode('resize-bottom')
      resizeStartRef.current = { clientX: e.clientX, clientY: e.clientY, block: { ...b } }
    } else {
      // Move mode
      const gridCol = Math.floor((e.clientX - rect.left) / cellW)
      const gridRow = Math.floor((e.clientY - rect.top) / cellH)
      setDraggingBlock(index)
      setDragMode('move')
      setDragOffset({ col: gridCol - b.col, row: gridRow - b.row })
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (draggingBlock === null || !gridRef.current || !dragMode) return

    const rect = gridRef.current.getBoundingClientRect()
    const cellW = rect.width / gridCols
    const cellH = rect.height / gridRows

    if (dragMode === 'move') {
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
    } else if (dragMode === 'resize-right' && resizeStartRef.current) {
      const orig = resizeStartRef.current.block
      const deltaPixels = e.clientX - resizeStartRef.current.clientX
      const deltaCells = Math.round(deltaPixels / cellW)
      const newWidth = Math.max(1, orig.width + deltaCells)
      if (canPlace(orig.col, orig.row, newWidth, orig.height, draggingBlock)) {
        setBlocks((prev) => {
          const updated = [...prev]
          updated[draggingBlock] = { ...prev[draggingBlock], width: newWidth }
          return updated
        })
      }
    } else if (dragMode === 'resize-bottom' && resizeStartRef.current) {
      const orig = resizeStartRef.current.block
      const deltaPixels = e.clientY - resizeStartRef.current.clientY
      const deltaCells = Math.round(deltaPixels / cellH)
      const newHeight = Math.max(1, orig.height + deltaCells)
      if (canPlace(orig.col, orig.row, orig.width, newHeight, draggingBlock)) {
        setBlocks((prev) => {
          const updated = [...prev]
          updated[draggingBlock] = { ...prev[draggingBlock], height: newHeight }
          return updated
        })
      }
    }
  }

  function handlePointerUp() {
    if (selectingFrom) {
      finalizeCellSelection()
    }
    setDraggingBlock(null)
    setDragMode(null)
    resizeStartRef.current = null
  }

  function cancelGesture() {
    setSelectingFrom(null)
    setCellSelection(null)
    setDraggingBlock(null)
    setDragMode(null)
    resizeStartRef.current = null
  }

  function changeZoom(next: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    cancelGesture()
    const scale = next / zoom
    const left = (viewport.scrollLeft + viewport.clientWidth / 2) * scale - viewport.clientWidth / 2
    const top = (viewport.scrollTop + viewport.clientHeight / 2) * scale - viewport.clientHeight / 2
    setZoom(next)
    requestAnimationFrame(() => {
      viewport.scrollLeft = next === 1 ? 0 : left
      viewport.scrollTop = next === 1 ? 0 : top
    })
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await saveStoreMap(storeId, {
        grid_cols: gridCols,
        grid_rows: gridRows,
        entrance_position: entrance,
        checkout_position: checkout,
        blocks,
      })
      if (result.error) { setSaveError(result.error); return }
      setMode('view')
    } catch {
      setSaveError('Kunne ikkje lagre kartet. Prøv igjen.')
    } finally {
      setSaving(false)
    }
  }

  function clearMap() {
    if (blocks.length === 0) return
    setBlocks([])
    setSelectedSection(null)
  }

  // Compute duplicate labels: if a section appears multiple times, label them "Name 1", "Name 2"
  const sectionBlockCounts: Record<string, number> = {}
  blocks.forEach((b) => { sectionBlockCounts[b.section_id] = (sectionBlockCounts[b.section_id] || 0) + 1 })
  const sectionBlockIndex: Record<string, number> = {}
  const blockLabels: string[] = blocks.map((b) => {
    const section = sectionMap[b.section_id]
    if (!section) return ''
    if (sectionBlockCounts[b.section_id] > 1) {
      sectionBlockIndex[b.section_id] = (sectionBlockIndex[b.section_id] || 0) + 1
      return `${section.name_nn} ${sectionBlockIndex[b.section_id]}`
    }
    return section.name_nn
  })

  return (
    <div className="mx-auto max-w-lg px-4 pt-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-[#0F172A]">{t('map.title')}</h1>
          <p className="text-xs text-[#64748B]">{storeName}</p>
        </div>
        {canEdit && (
          <div className="flex rounded-lg border overflow-hidden">
            <button
              onClick={() => { cancelGesture(); setMode('view') }}
              className={`px-3 py-1.5 text-xs font-medium ${
                mode === 'view' ? 'bg-primary text-white' : 'bg-white text-[#64748B]'
              }`}
            >
              <Eye className="h-3.5 w-3.5 inline mr-1" />
              {t('map.view')}
            </button>
            <button
              onClick={() => { cancelGesture(); setPanning(false); setMode('edit') }}
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
              onClick={() => { setPlacingEntrance(true); setPlacingCheckout(false); setSelectedSection(null); setCellSelection(null) }}
              className={`flex-1 flex items-center justify-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors ${
                placingEntrance ? 'ring-2 ring-primary bg-primary/5' : 'bg-white'
              }`}
            >
              🚪 Plasser inngang
            </button>
            <button
              onClick={() => { setPlacingCheckout(true); setPlacingEntrance(false); setSelectedSection(null); setCellSelection(null) }}
              className={`flex-1 flex items-center justify-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors ${
                placingCheckout ? 'ring-2 ring-primary bg-primary/5' : 'bg-white'
              }`}
            >
              💳 Plasser kasse
            </button>
            <button
              onClick={clearMap}
              disabled={blocks.length === 0}
              className="flex items-center justify-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors bg-white text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Section palette */}
          <div className="flex flex-wrap gap-1.5 p-2 bg-white rounded-lg border">
            {sections.map((section) => {
              return (
                <button
                  key={section.id}
                  onClick={() => {
                    if (cellSelection) {
                      placeAtSelection(section.id)
                      return
                    }
                    setSelectedSection(selectedSection === section.id ? null : section.id)
                    setPlacingEntrance(false)
                    setPlacingCheckout(false)
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    selectedSection === section.id
                      ? 'ring-2 ring-offset-1 ring-primary scale-105'
                      : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: section.color + '20',
                    color: section.color,
                  }}
                >
                  <span>{section.icon}</span>
                  <span>{section.name_nn}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!canEdit && mode === 'view' && (
        <p className="text-xs text-[#94A3B8] mb-3 text-center">{t('map.no_permission')}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button type="button" onClick={() => changeZoom(Math.max(1, zoom - 0.5))} disabled={zoom === 1}
          aria-label="Zoom ut" className="h-11 w-11 rounded-lg border bg-white text-xl disabled:opacity-30">−</button>
        <span className="text-xs tabular-nums min-w-[3rem] text-center" aria-live="polite">{zoom * 100}%</span>
        <button type="button" onClick={() => changeZoom(Math.min(4, zoom + 0.5))} disabled={zoom === 4}
          aria-label="Zoom inn" className="h-11 w-11 rounded-lg border bg-white text-xl disabled:opacity-30">+</button>
        <button type="button" onClick={() => changeZoom(1)} className="min-h-11 px-3 rounded-lg border bg-white text-xs">Vis heile</button>
        {mode === 'edit' && (
          <button type="button" aria-pressed={panning} onClick={() => { cancelGesture(); setPanning(!panning) }}
            className={`min-h-11 px-3 rounded-lg border text-xs ${panning ? 'bg-primary text-white' : 'bg-white'}`}>
            Flytt kartet
          </button>
        )}
      </div>
      {mode === 'edit' && (
        <p className="text-xs text-[#64748B] mb-2">
          {panning ? 'Dra for å flytte kartet. Slå av «Flytt kartet» for å redigere.' : 'Zoom inn for å redigere små felt. Vel «Flytt kartet» for å sjå andre delar.'}
        </p>
      )}

      {/* Native scrolling is available in view/pan mode; edit gestures stay on the grid. */}
      <div ref={viewportRef} className="overflow-auto rounded-lg border max-h-[65dvh]" tabIndex={0} role="region" aria-label="Butikkart">
      <div
        ref={gridRef}
        className="relative bg-[#F1F5F9] overflow-hidden"
        style={{
          width: `${zoom * 100}%`,
          aspectRatio: `${gridCols}/${gridRows}`,
          touchAction: editing ? 'none' : 'pan-x pan-y pinch-zoom',
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={cancelGesture}
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

        {/* Cell interaction layer: one element that works out the cell from the pointer
            position, instead of one element per cell (cheap at any grid size) */}
        {editing && (
          <div
            className="absolute inset-0 cursor-crosshair"
            style={{ zIndex: 2 }}
            onPointerDown={(e) => {
              e.preventDefault()
              const c = cellAt(e.clientX, e.clientY)
              if (c) handleCellPointerDown(c.col, c.row)
            }}
            onPointerMove={(e) => {
              if (!selectingFrom) return
              const c = cellAt(e.clientX, e.clientY)
              if (c) handleCellPointerEnter(c.col, c.row)
            }}
          />
        )}

        {/* Selection rectangle overlay */}
        {editing && cellSelection && (
          <div
            className="absolute rounded border-2 border-dashed border-primary bg-primary/10 pointer-events-none"
            style={{
              left: `${(cellSelection.col / gridCols) * 100}%`,
              top: `${(cellSelection.row / gridRows) * 100}%`,
              width: `${(cellSelection.w / gridCols) * 100}%`,
              height: `${(cellSelection.h / gridRows) * 100}%`,
              zIndex: 3,
            }}
          >
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary">
              {cellSelection.w}×{cellSelection.h}
            </span>
          </div>
        )}

        {/* Section tiles */}
        {blocks.map((block, index) => {
          const section = sectionMap[block.section_id]
          if (!section) return null
          const walkNum = walkOrderMap[block.section_id]
          const tileLabel = blockLabels[index]
          const isTallNarrow = block.height > block.width
          const isLargeEnough = block.width >= 2 || block.height >= 2

          return (
            <div
              key={`block-${index}`}
              className={`absolute flex flex-col items-center justify-center rounded-md shadow-sm select-none ${
                editing ? 'cursor-grab active:cursor-grabbing' : ''
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
              onPointerDown={(e) => onTilePointerDown(index, e)}
            >
              {/* Walk order number */}
              {walkNum !== undefined && (
                <div
                  className="absolute top-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/90 text-[8px] font-bold"
                  style={{ color: section.color }}
                >
                  {walkNum}
                </div>
              )}

              {/* Remove button - only in edit mode, top-right corner */}
              {editing && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => removeBlock(index, e)}
                  aria-label={`Fjern ${section.name_nn}`}
                  className="absolute -top-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white text-sm font-bold shadow-md hover:bg-red-600"
                  style={{ zIndex: 25 }}
                >
                  ×
                </button>
              )}

              {/* Icon */}
              <span className="text-base leading-none">{section.icon}</span>

              {/* Label: rotate 90° for tall narrow tiles */}
              {isLargeEnough && (
                <span
                  className="text-[9px] text-white font-semibold leading-tight text-center truncate max-w-full px-1"
                  style={isTallNarrow ? {
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                    maxHeight: '100%',
                    maxWidth: 'none',
                  } : undefined}
                >
                  {tileLabel}
                </span>
              )}

              {/* Edge drag hints in edit mode */}
              {editing && (
                <>
                  {/* Right edge hint */}
                  <div
                    className="absolute top-1 bottom-1 right-0 w-1 rounded-r bg-white/40"
                    style={{ zIndex: 6 }}
                  />
                  {/* Bottom edge hint */}
                  <div
                    className="absolute left-1 right-1 bottom-0 h-1 rounded-b bg-white/40"
                    style={{ zIndex: 6 }}
                  />
                </>
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
      </div>

      {/* Short legend */}
      <div className="flex items-center justify-between mt-3 text-xs text-[#94A3B8]">
        <span>🚪 {t('map.entrance')} · 💳 {t('map.checkout')}</span>
        <span suppressHydrationWarning>{blocks.length} seksjonar plasserte</span>
      </div>

      {/* Save button (edit mode) */}
      {mode === 'edit' && (
        <div className="fixed bottom-20 left-0 right-0 px-4">
          <div className="mx-auto max-w-lg">
            {saveError && <p role="alert" className="mb-2 rounded-lg bg-white p-2 text-sm text-red-600">{saveError}</p>}
            <Button onClick={handleSave} className="w-full h-12" disabled={saving}>
              {saving ? 'Lagrar...' : t('map.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
