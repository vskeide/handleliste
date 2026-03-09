'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { t } from '@/lib/i18n'
import { saveWalkOrder } from '@/lib/actions/stores'
import { Button } from '@/components/ui/button'
import { ArrowLeft, GripVertical } from 'lucide-react'
import type { Section, WalkOrder } from '@/lib/types'

interface Props {
  storeId: string
  storeName: string
  sections: Section[]
  initialWalkOrder: WalkOrder[]
  canEditShared: boolean
}

function SortableItem({ section, index }: { section: Section; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: section.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg bg-white p-3 border border-[#E2E8F0] shadow-sm"
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white flex-shrink-0"
        style={{ backgroundColor: section.color }}
      >
        {index + 1}
      </span>
      <span className="text-lg">{section.icon}</span>
      <span className="text-sm font-medium text-[#0F172A] flex-1">{section.name_nn}</span>
      <button {...attributes} {...listeners} className="text-[#94A3B8] touch-none cursor-grab active:cursor-grabbing">
        <GripVertical className="h-5 w-5" />
      </button>
    </div>
  )
}

export function SectionSorterClient({ storeId, storeName, sections, initialWalkOrder, canEditShared }: Props) {
  const router = useRouter()

  // Sort sections by initial walk order
  const sortedIds = initialWalkOrder
    .sort((a, b) => a.walk_order - b.walk_order)
    .map((wo) => wo.section_id)

  // Fill in any sections not in the walk order
  const allSectionIds = sections.map((s) => s.id)
  const orderedIds = [
    ...sortedIds.filter((id) => allSectionIds.includes(id)),
    ...allSectionIds.filter((id) => !sortedIds.includes(id)),
  ]

  const [order, setOrder] = useState<string[]>(orderedIds)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setOrder((items) => {
        const oldIndex = items.indexOf(active.id as string)
        const newIndex = items.indexOf(over.id as string)
        return arrayMove(items, oldIndex, newIndex)
      })
      setSaved(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    const walkOrders = order.map((sectionId, index) => ({
      section_id: sectionId,
      walk_order: index + 1,
    }))
    await saveWalkOrder(storeId, walkOrders)
    setSaving(false)
    setSaved(true)
  }

  const sectionMap: Record<string, Section> = {}
  sections.forEach((s) => { sectionMap[s.id] = s })

  return (
    <div className="mx-auto max-w-lg px-4 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-2">
        <Link href={`/butikkar/${storeId}`} className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[#0F172A]">{t('mapping.title')}</h1>
          <p className="text-xs text-[#64748B]">{storeName}</p>
        </div>
      </div>

      <p className="text-sm text-[#64748B] mb-4">{t('mapping.instruction')}</p>

      <div className="rounded-lg bg-[#F1F5F9] p-2 mb-4 text-center">
        <p className="text-xs text-[#64748B]">
          {canEditShared ? t('mapping.shared_note') : t('mapping.custom_note')}
        </p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {order.map((sectionId, index) => {
              const section = sectionMap[sectionId]
              if (!section) return null
              return <SortableItem key={sectionId} section={section} index={index} />
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="fixed bottom-20 left-0 right-0 px-4">
        <div className="mx-auto max-w-lg">
          <Button onClick={handleSave} className="w-full h-12" disabled={saving}>
            {saving ? 'Lagrar...' : saved ? 'Lagra!' : t('mapping.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
