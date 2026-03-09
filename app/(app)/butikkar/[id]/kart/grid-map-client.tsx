'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { t } from '@/lib/i18n'
import { saveStoreMap } from '@/lib/actions/stores'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Eye, Pencil } from 'lucide-react'
import type { Section, StoreMap, StoreMapBlock, WalkOrder } from '@/lib/types'

interface Props {
  storeId: string
  storeName: string
  sections: Section[]
  storeMap: StoreMap | null
  walkOrder: WalkOrder[]
  canEdit: boolean
}

export function GridMapClient({ storeId, storeName, sections, storeMap, walkOrder, canEdit }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [blocks, setBlocks] = useState<StoreMapBlock[]>(storeMap?.blocks || [])
  const [gridCols] = useState(storeMap?.grid_cols || 12)
  const [gridRows] = useState(storeMap?.grid_rows || 14)
  const [entrance] = useState(storeMap?.entrance_position || { col: 0, row: 13 })
  const [checkout] = useState(storeMap?.checkout_position || { col: 11, row: 13 })
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const sectionMap: Record<string, Section> = {}
  sections.forEach((s) => { sectionMap[s.id] = s })
  const walkOrderMap: Record<string, number> = {}
  walkOrder.forEach((wo) => { walkOrderMap[wo.section_id] = wo.walk_order })

  // Build a grid lookup: cell -> block info
  function getCellBlock(col: number, row: number): { block: StoreMapBlock; section: Section; isOrigin: boolean } | null {
    for (const block of blocks) {
      if (
        col >= block.col &&
        col < block.col + block.width &&
        row >= block.row &&
        row < block.row + block.height
      ) {
        const section = sectionMap[block.section_id]
        if (!section) continue
        const isOrigin = col === block.col && row === block.row
        return { block, section, isOrigin }
      }
    }
    return null
  }

  function handleCellClick(col: number, row: number) {
    if (mode !== 'edit') return

    const existing = getCellBlock(col, row)
    if (existing) {
      // Remove block
      setBlocks((prev) => prev.filter((b) => b !== existing.block))
    } else if (selectedSection) {
      // Add 1x1 block
      setBlocks((prev) => [
        ...prev,
        { section_id: selectedSection, col, row, width: 1, height: 1 },
      ])
    }
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

  const cellSize = `minmax(0, 1fr)`

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

      {/* Section palette (edit mode) */}
      {mode === 'edit' && (
        <div className="flex flex-wrap gap-2 mb-4 p-3 bg-white rounded-lg border">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setSelectedSection(selectedSection === section.id ? null : section.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all ${
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
              <span className="hidden sm:inline">{section.name_nn}</span>
            </button>
          ))}
        </div>
      )}

      {!canEdit && mode === 'view' && (
        <p className="text-xs text-[#94A3B8] mb-3 text-center">{t('map.no_permission')}</p>
      )}

      {/* Grid */}
      <div
        className="grid gap-px bg-[#E2E8F0] rounded-lg overflow-hidden border"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, ${cellSize})`,
          gridTemplateRows: `repeat(${gridRows}, minmax(24px, 1fr))`,
        }}
      >
        {Array.from({ length: gridRows }, (_, row) =>
          Array.from({ length: gridCols }, (_, col) => {
            const cellBlock = getCellBlock(col, row)
            const isEntrance = entrance.col === col && entrance.row === row
            const isCheckout = checkout.col === col && checkout.row === row

            if (cellBlock && !cellBlock.isOrigin) {
              // Part of a multi-cell block but not the origin — skip rendering
              return null
            }

            if (cellBlock && cellBlock.isOrigin) {
              const { block, section } = cellBlock
              const walkNum = walkOrderMap[section.id]
              return (
                <div
                  key={`${col}-${row}`}
                  onClick={() => handleCellClick(col, row)}
                  className={`relative flex flex-col items-center justify-center p-0.5 ${
                    mode === 'edit' ? 'cursor-pointer' : ''
                  }`}
                  style={{
                    gridColumn: `${col + 1} / span ${block.width}`,
                    gridRow: `${row + 1} / span ${block.height}`,
                    backgroundColor: section.color + 'CC',
                  }}
                >
                  <div className="absolute top-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/90 text-[8px] font-bold"
                    style={{ color: section.color }}>
                    {walkNum}
                  </div>
                  <span className="text-xs">{section.icon}</span>
                  {block.width >= 2 && block.height >= 2 && (
                    <span className="text-[8px] text-white font-medium leading-tight text-center truncate max-w-full px-0.5">
                      {section.name_nn}
                    </span>
                  )}
                </div>
              )
            }

            return (
              <div
                key={`${col}-${row}`}
                onClick={() => handleCellClick(col, row)}
                className={`flex items-center justify-center text-[8px] ${
                  mode === 'edit'
                    ? 'cursor-pointer hover:bg-[#F1F5F9] bg-white'
                    : 'bg-white'
                }`}
                style={{
                  gridColumn: `${col + 1}`,
                  gridRow: `${row + 1}`,
                }}
              >
                {isEntrance && <span title={t('map.entrance')}>🚪</span>}
                {isCheckout && <span title={t('map.checkout')}>💳</span>}
              </div>
            )
          })
        )}
      </div>

      {/* Info bar */}
      <div className="flex items-center justify-between mt-3 text-xs text-[#94A3B8]">
        <span>🚪 {t('map.entrance')} · 💳 {t('map.checkout')}</span>
        <span>{t('map.shared_label')}</span>
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
