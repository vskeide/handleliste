'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { t } from '@/lib/i18n'
import { saveStoreMap } from '@/lib/actions/stores'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Eye, Pencil, Trash2, Move, Undo2, X } from 'lucide-react'
import { canPlaceBlock, clamp, resizeBlock, twoFingerFrame, zoomScroll, type Point, type ResizeEdge } from '@/lib/map-geometry'
import type { Section, StoreMap, StoreMapBlock, WalkOrder } from '@/lib/types'

interface Props { storeId: string; storeName: string; sections: Section[]; storeMap: StoreMap | null; walkOrder: WalkOrder[]; canEdit: boolean }
type Drag = { index: number; edge: ResizeEdge | 'move'; start: Point; block: StoreMapBlock; pointerId: number }
type Selection = { col: number; row: number; w: number; h: number }
type Pinch = { zoom: number; distance: number; anchor: Point }
const EDGES: ResizeEdge[] = ['left', 'right', 'top', 'bottom']
const EDGE_NAMES = { left: 'venstre kant', right: 'høgre kant', top: 'øvre kant', bottom: 'nedre kant' }

export function GridMapClient({ storeId, storeName, sections, storeMap, walkOrder, canEdit }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [panning, setPanning] = useState(false)
  const editing = mode === 'edit' && !panning
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const gridCols = storeMap?.grid_cols || 16, gridRows = storeMap?.grid_rows || 20
  const [blocks, setBlocks] = useState<StoreMapBlock[]>(storeMap?.blocks || [])
  const [entrance, setEntrance] = useState(storeMap?.entrance_position || { col: 0, row: gridRows - 1 })
  const [checkout, setCheckout] = useState(storeMap?.checkout_position || { col: gridCols - 1, row: gridRows - 1 })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteRef = useRef<HTMLDialogElement>(null)
  const [navigating, setNavigating] = useState(false)
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null)
  const [placing, setPlacing] = useState<'entrance' | 'checkout' | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const selectionRef = useRef<Selection | null>(null)
  const selectionStart = useRef<{ col: number; row: number } | null>(null)
  const [dragging, setDragging] = useState<Drag | null>(null)
  const drag = useRef<Drag | null>(null)
  const [dragPoint, setDragPoint] = useState<Point | null>(null)
  const [overBin, setOverBin] = useState(false)
  const [moveArmed, setMoveArmed] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [removed, setRemoved] = useState<{ block: StoreMapBlock; index: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null), gridRef = useRef<HTMLDivElement>(null), binRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const multiTouch = useRef(false)
  const pinch = useRef<Pinch | null>(null)
  const pan = useRef<{ start: Point; left: number; top: number } | null>(null)
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; start: Point } | null>(null)
  const frame = useRef<number | null>(null)
  const sectionMap = Object.fromEntries(sections.map(s => [s.id, s]))
  const walk = Object.fromEntries(walkOrder.map(w => [w.section_id, w.walk_order]))

  useEffect(() => () => { if (hold.current) clearTimeout(hold.current.timer); if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  useEffect(() => {
    const dialog = paletteRef.current
    if (paletteOpen) dialog?.showModal()
    else dialog?.close()
  }, [paletteOpen])
  const point = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY })
  function clearHold() { if (hold.current) clearTimeout(hold.current.timer); hold.current = null }
  function setCellSelection(next: Selection | null) { selectionRef.current = next; setSelection(next) }
  function cancelEdit(revert = true) {
    const current = drag.current
    if (revert && current) setBlocks(previous => previous.map((b,i) => i === current.index ? current.block : b))
    clearHold(); drag.current = null; setDragging(null); setDragPoint(null); setOverBin(false)
    selectionStart.current = null; setCellSelection(null)
  }
  function cancelGesture() { cancelEdit(); setPaletteOpen(false); pinch.current = null; pan.current = null; multiTouch.current = false; pointers.current.clear(); setNavigating(false) }
  function cellAt(p: Point) {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return null
    const col = Math.floor((p.x - rect.left) / rect.width * gridCols), row = Math.floor((p.y - rect.top) / rect.height * gridRows)
    return col >= 0 && row >= 0 && col < gridCols && row < gridRows ? { col, row } : null
  }
  function fits(b: StoreMapBlock, exclude = -1) { return canPlaceBlock(b, blocks, gridCols, gridRows, exclude) }
  function capture(id: number) { try { viewportRef.current?.setPointerCapture(id) } catch {} }
  function insideBin(p: Point) {
    const b = binRef.current?.getBoundingClientRect()
    return !!b && p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom
  }

  function applyZoom(next: number, anchor: Point, center: Point) {
    const viewport = viewportRef.current
    if (!viewport) return
    next = clamp(next, 1, 4); zoomRef.current = next; setZoom(next)
    const scroll = zoomScroll(anchor, center, next, viewport.clientWidth, gridCols, gridRows)
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => { viewport.scrollLeft = scroll.left; viewport.scrollTop = scroll.top; frame.current = null })
  }
  function changeZoom(next: number) {
    cancelGesture()
    const viewport = viewportRef.current, grid = gridRef.current
    if (!viewport || !grid) return
    const v = viewport.getBoundingClientRect(), g = grid.getBoundingClientRect()
    const center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
    applyZoom(next, { x: (v.left + center.x - g.left) / g.width, y: (v.top + center.y - g.top) / g.height }, center)
    if (next === 1) requestAnimationFrame(() => { viewport.scrollLeft = 0; viewport.scrollTop = 0 })
  }

  function onPointerDownCapture(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointers.current.set(e.pointerId, point(e))
    if (pointers.current.size >= 2) {
      cancelEdit(); pan.current = null; multiTouch.current = true; setNavigating(true)
      const [a, b] = Array.from(pointers.current.values()), gesture = twoFingerFrame(a,b)
      const g = gridRef.current!.getBoundingClientRect()
      pinch.current = { zoom: zoomRef.current, distance: gesture.distance, anchor: { x: (gesture.center.x - g.left) / g.width, y: (gesture.center.y - g.top) / g.height } }
      for (const id of pointers.current.keys()) capture(id)
      e.preventDefault(); e.stopPropagation()
    } else if (!editing) {
      pan.current = { start: point(e), left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }
      capture(e.pointerId); e.preventDefault()
    }
  }
  function startDrag(index: number, edge: Drag['edge'], p: Point, pointerId: number) {
    if (!blocks[index] || multiTouch.current) return
    clearHold(); selectionStart.current = null; setCellSelection(null); setMenu(null); setMoveArmed(false)
    drag.current = { index, edge, start: p, block: { ...blocks[index] }, pointerId }
    setDragging(drag.current); setDragPoint(p); capture(pointerId)
  }
  function onTilePointerDown(index: number, e: React.PointerEvent) {
    if (!editing || multiTouch.current || e.button !== 0) return
    e.preventDefault(); e.stopPropagation(); setMenu(null); setSelectedBlock(index); setCellSelection(null)
    setPlacing(null)
    const p = point(e), id = e.pointerId
    if (e.pointerType !== 'touch' || moveArmed) startDrag(index, 'move', p, id)
    else {
      clearHold()
      hold.current = { start: p, timer: setTimeout(() => { startDrag(index, 'move', p, id); navigator.vibrate?.(25) }, 350) }
    }
  }
  function onCellPointerDown(e: React.PointerEvent) {
    if (!editing || multiTouch.current || e.button !== 0) return
    e.preventDefault(); clearHold(); setMenu(null); setSelectedBlock(null); setMoveArmed(false)
    const c = cellAt(point(e)); if (!c) return
    if (placing) { if (placing === 'entrance') setEntrance(c); else setCheckout(c); setPlacing(null); return }
    selectionStart.current = c; setCellSelection({ ...c, w: 1, h: 1 }); capture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, point(e))
    if (multiTouch.current) {
      if (pointers.current.size >= 2 && pinch.current) {
        const [a,b] = Array.from(pointers.current.values()), gesture = twoFingerFrame(a,b), rect = e.currentTarget.getBoundingClientRect()
        applyZoom(pinch.current.zoom * gesture.distance / pinch.current.distance, pinch.current.anchor, { x: gesture.center.x - rect.left, y: gesture.center.y - rect.top })
      }
      e.preventDefault(); return
    }
    if (pan.current) {
      e.currentTarget.scrollLeft = pan.current.left - (e.clientX - pan.current.start.x)
      e.currentTarget.scrollTop = pan.current.top - (e.clientY - pan.current.start.y)
      return
    }
    if (hold.current && Math.hypot(e.clientX - hold.current.start.x, e.clientY - hold.current.start.y) > 8) clearHold()
    const current = drag.current
    if (current && gridRef.current) {
      const r = gridRef.current.getBoundingClientRect(), dx = Math.round((e.clientX - current.start.x) / r.width * gridCols), dy = Math.round((e.clientY - current.start.y) / r.height * gridRows)
      const next = current.edge === 'move' ? { ...current.block, col: clamp(current.block.col + dx,0,gridCols-current.block.width), row: clamp(current.block.row + dy,0,gridRows-current.block.height) }
        : resizeBlock(current.block,current.edge,dx,dy,gridCols,gridRows)
      if (fits(next,current.index)) setBlocks(previous => previous.map((b,i) => i === current.index ? next : b))
      setDragPoint(point(e)); setOverBin(current.edge === 'move' && insideBin(point(e)))
    } else if (selectionStart.current) {
      const c = cellAt(point(e)); if (!c) return
      const start = selectionStart.current
      const next = { col: Math.min(c.col,start.col), row: Math.min(c.row,start.row), w: Math.abs(c.col-start.col)+1, h: Math.abs(c.row-start.row)+1 }
      if (fits({ section_id: '', col: next.col, row: next.row, width: next.w, height: next.h })) setCellSelection(next)
    }
  }
  function deleteBlock(index: number) {
    if (!blocks[index]) return
    setRemoved({ block: drag.current?.index === index ? drag.current.block : blocks[index], index }); setBlocks(previous => previous.filter((_,i) => i !== index))
    setSelectedBlock(null); setMenu(null); setMoveArmed(false); cancelEdit(false)
  }
  function placeAtSelection(sectionId: string) {
    const s = selectionRef.current
    if (s) {
      const block = { section_id: sectionId, col: s.col, row: s.row, width: s.w, height: s.h }
      if (fits(block)) { setBlocks(previous => [...previous,block]); setSelectedBlock(blocks.length) }
    }
    setCellSelection(null); setPaletteOpen(false)
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId); clearHold()
    if (multiTouch.current) {
      if (!pointers.current.size) { multiTouch.current = false; pinch.current = null; pan.current = null; setNavigating(false) }
      return
    }
    const current = drag.current
    if (current?.edge === 'move' && insideBin(point(e))) deleteBlock(current.index)
    else if (selectionStart.current && selectionRef.current) setPaletteOpen(true)
    selectionStart.current = null; drag.current = null; pan.current = null
    setDragging(null); setDragPoint(null); setOverBin(false)
  }
  function undoDelete() {
    if (!removed) return
    if (!fits(removed.block)) { setError('Flytt feltet som er i vegen før du angrar slettinga.'); return }
    setBlocks(previous => [...previous.slice(0,removed.index),removed.block,...previous.slice(removed.index)])
    setSelectedBlock(removed.index); setRemoved(null); setError(null)
  }
  function armMove(index: number) { cancelEdit(); setSelectedBlock(index); setMoveArmed(true); setMenu(null) }
  function keyMove(index: number, e: React.KeyboardEvent) {
    if (!editing) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteBlock(index); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedBlock(index); return }
    const steps: Record<string,Point> = { ArrowLeft: { x:-1,y:0 }, ArrowRight: { x:1,y:0 }, ArrowUp: { x:0,y:-1 }, ArrowDown: { x:0,y:1 } }
    const d = steps[e.key]; if (!d) return
    e.preventDefault(); const b = blocks[index], next = { ...b, col: b.col+d.x, row: b.row+d.y }
    if (fits(next,index)) setBlocks(previous => previous.map((block,i) => i === index ? next : block))
  }
  async function handleSave() {
    cancelGesture(); setSaving(true); setError(null)
    try {
      const result = await saveStoreMap(storeId,{ grid_cols: gridCols,grid_rows: gridRows,entrance_position: entrance,checkout_position: checkout,blocks })
      if (result.error) { setError(result.error); return }
      setMode('view'); setSelectedBlock(null); setMenu(null); setRemoved(null)
    } catch { setError('Kunne ikkje lagre kartet. Prøv igjen.') }
    finally { setSaving(false) }
  }

  const selected = selectedBlock === null ? null : blocks[selectedBlock]
  const selectedName = selected ? sectionMap[selected.section_id]?.name_nn : ''
  return <div className="mx-auto max-w-lg px-3 pt-3 pb-4">
    <div className="flex items-center gap-2 mb-3">
      <button onClick={() => router.back()} className="text-[#64748B]" aria-label="Tilbake"><ArrowLeft className="h-5 w-5" /></button>
      <div className="flex-1 min-w-0"><h1 className="text-lg font-bold">{t('map.title')}</h1><p className="text-xs text-[#64748B]">{storeName}</p></div>
      {canEdit && <div className="flex rounded-lg border overflow-hidden">
        <button onClick={() => { cancelGesture(); setMode('view'); setSelectedBlock(null); setMenu(null) }} className={`min-h-11 px-3 text-xs ${mode==='view'?'bg-primary text-white':'bg-white'}`}><Eye className="h-4 w-4 inline mr-1" />{t('map.view')}</button>
        {mode==='view' && <button onClick={() => { cancelGesture(); setMode('edit'); setPanning(false) }} className="min-h-11 px-3 text-xs bg-white"><Pencil className="h-4 w-4 inline mr-1" />{t('map.edit')}</button>}
      </div>}
      {mode==='edit' && <Button onClick={handleSave} className="min-h-11 px-3" disabled={saving}>{saving?'Lagrar…':'Lagre kart'}</Button>}
    </div>
    {mode==='edit' && <div className="mb-3 space-y-2">
      <div className="flex gap-2">
        <button onClick={() => { cancelGesture(); setPlacing(placing==='entrance'?null:'entrance'); setPanning(false); setSelectedBlock(null) }} className={`flex-1 min-h-11 rounded-lg border p-2 text-xs bg-white ${placing==='entrance'?'ring-2 ring-primary':''}`}>🚪 Plasser inngang</button>
        <button onClick={() => { cancelGesture(); setPlacing(placing==='checkout'?null:'checkout'); setPanning(false); setSelectedBlock(null) }} className={`flex-1 min-h-11 rounded-lg border p-2 text-xs bg-white ${placing==='checkout'?'ring-2 ring-primary':''}`}>💳 Plasser kasse</button>
        <button onClick={() => { if (blocks.length && confirm('Tømme heile kartet? Endringa blir lagra når du trykkjer «Lagre kart».')) { cancelGesture(); setBlocks([]); setSelectedBlock(null) } }} className="min-h-11 rounded-lg border px-3 text-xs bg-white text-red-600">Tøm kartet</button>
      </div>
    </div>}
    <div className="hidden flex-wrap items-center gap-2 mb-2 [@media(pointer:fine)]:flex">
      <button onClick={() => changeZoom(Math.max(1,zoom-0.5))} disabled={zoom<=1} aria-label="Zoom ut" className="h-11 w-11 rounded-lg border bg-white text-xl disabled:opacity-30">−</button>
      <span aria-live="polite" className="min-w-[3rem] text-center text-xs tabular-nums">{Math.round(zoom*100)}%</span>
      <button onClick={() => changeZoom(Math.min(4,zoom+0.5))} disabled={zoom>=4} aria-label="Zoom inn" className="h-11 w-11 rounded-lg border bg-white text-xl disabled:opacity-30">+</button>
      <button onClick={() => changeZoom(1)} className="min-h-11 rounded-lg border bg-white px-3 text-xs">Vis heile</button>
      {mode==='edit' && <button aria-pressed={panning} onClick={() => { cancelGesture(); setPanning(!panning); setMenu(null) }} className={`min-h-11 rounded-lg border px-3 text-xs ${panning?'bg-primary text-white':'bg-white'}`}>Flytt kartet</button>}
    </div>
    <p className="mb-2 text-xs text-[#64748B]">{placing ? `Trykk i kartet for å plassere ${placing==='entrance'?'inngangen':'kassa'}.` : mode==='edit' ? 'Marker eit tomt område for å leggje til felt. To fingrar flyttar og zoomar.' : 'Dra for å flytte kartet. Bruk to fingrar for å zoome.'}</p>
    {error && <p role="alert" className="mb-2 rounded-lg bg-white p-2 text-sm text-red-600">{error}</p>}
    {removed && mode==='edit' && <button onClick={undoDelete} className="mb-2 min-h-11 rounded-lg border bg-white px-3 text-sm"><Undo2 className="mr-1 inline h-4 w-4" />Angre sletting</button>}
    <div className="relative">
    <div ref={viewportRef} className="h-[calc(100dvh-19rem)] min-h-64 overflow-auto rounded-lg border bg-[#F8FAFC] [@media(pointer:fine)]:h-[calc(100dvh-22rem)]" role="region" aria-label="Butikkart" tabIndex={0}
      style={{ touchAction:'none',WebkitTouchCallout:'none',scrollbarGutter:'stable' }} onPointerDownCapture={onPointerDownCapture} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={cancelGesture} onContextMenu={e => { if (mode==='edit') e.preventDefault() }}>
      <div className="p-4" style={{ width:`${zoom*100}%` }}>
        <div ref={gridRef} className="relative rounded-lg border bg-[#F1F5F9]" style={{ aspectRatio:`${gridCols}/${gridRows}` }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {Array.from({length:gridCols+1},(_,i)=><line key={`v${i}`} x1={`${i/gridCols*100}%`} y1="0" x2={`${i/gridCols*100}%`} y2="100%" stroke="#E2E8F0" />)}
            {Array.from({length:gridRows+1},(_,i)=><line key={`h${i}`} x1="0" y1={`${i/gridRows*100}%`} x2="100%" y2={`${i/gridRows*100}%`} stroke="#E2E8F0" />)}
          </svg>
          {editing && <div className="absolute inset-0 cursor-crosshair" style={{zIndex:2}} onPointerDown={onCellPointerDown} />}
          {selection && editing && <div className="pointer-events-none absolute rounded border-2 border-dashed border-primary bg-primary/10" style={{left:`${selection.col/gridCols*100}%`,top:`${selection.row/gridRows*100}%`,width:`${selection.w/gridCols*100}%`,height:`${selection.h/gridRows*100}%`,zIndex:3}}><span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary">{selection.w}×{selection.h}</span></div>}
          {blocks.map((b,index) => {
            const s=sectionMap[b.section_id]; if(!s)return null
            const chosen=editing && selectedBlock===index, tall=b.height>b.width
            return <div key={index} role="group" aria-label={`${s.name_nn} felt ${index+1}`} tabIndex={editing?0:-1} onKeyDown={e=>keyMove(index,e)}
              onFocus={()=>{if(editing)setSelectedBlock(index)}} onPointerDown={e=>onTilePointerDown(index,e)}
              onContextMenu={e=>{ if(!editing)return; e.preventDefault();e.stopPropagation();cancelEdit();setSelectedBlock(index);setMenu({x:Math.min(e.clientX,window.innerWidth-210),y:Math.min(e.clientY,window.innerHeight-170),index}) }}
              className={`absolute flex select-none flex-col items-center justify-center rounded-md shadow-sm ${chosen?'outline outline-2 outline-blue-600':''} ${editing?'cursor-grab':''}`}
              style={{left:`${b.col/gridCols*100}%`,top:`${b.row/gridRows*100}%`,width:`${b.width/gridCols*100}%`,height:`${b.height/gridRows*100}%`,backgroundColor:s.color+'CC',zIndex:chosen?30:5}}>
              {walk[b.section_id]!==undefined && <span className="pointer-events-none absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/90 text-[8px] font-bold" style={{color:s.color}}>{walk[b.section_id]}</span>}
              <span className="pointer-events-none text-base leading-none">{s.icon}</span>
              {(b.width>=2||b.height>=2) && <span className="pointer-events-none max-w-full truncate px-1 text-center text-[9px] font-semibold leading-tight text-white" style={tall?{writingMode:'vertical-rl',maxHeight:'100%',maxWidth:'none'}:undefined}>{s.name_nn}</span>}
              {chosen && !dragging && !moveArmed && !navigating && EDGES.map(edge=><button key={edge} type="button" aria-label={`Endre ${EDGE_NAMES[edge]} for ${s.name_nn}`}
                onPointerDown={e=>{if(multiTouch.current||e.button!==0)return;e.preventDefault();e.stopPropagation();startDrag(index,edge,point(e),e.pointerId)}}
                onKeyDown={e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'&&e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;e.preventDefault();e.stopPropagation();const next=resizeBlock(b,edge,e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0,e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0,gridCols,gridRows);if(fits(next,index))setBlocks(previous=>previous.map((block,i)=>i===index?next:block))}}
                className="absolute flex items-center justify-center rounded bg-blue-500/10"
                style={edge==='left'||edge==='right'?{width:44,height:'100%',minHeight:44,top:'50%',transform:'translateY(-50%)',[edge]:-22,cursor:'ew-resize'}:{height:44,width:'100%',minWidth:44,left:'50%',transform:'translateX(-50%)',[edge]:-22,cursor:'ns-resize'}}>
                <span className={`rounded-full bg-blue-600 ${edge==='left'||edge==='right'?'h-6 w-1.5':'h-1.5 w-6'}`} />
              </button>)}
            </div>
          })}
          {[{p:entrance,icon:'🚪'},{p:checkout,icon:'💳'}].map(({p,icon})=><div key={icon} className="pointer-events-none absolute flex items-center justify-center text-lg" style={{left:`${p.col/gridCols*100}%`,top:`${p.row/gridRows*100}%`,width:`${100/gridCols}%`,height:`${100/gridRows}%`,zIndex:15}}>{icon}</div>)}
        </div>
      </div>
    </div>
    {editing && selected && selectedBlock!==null && !dragging && !navigating && <div className="absolute bottom-2 left-2 right-2 z-40 flex items-center gap-2 rounded-lg border bg-white/95 p-2 shadow-sm">
      <span className="min-w-0 flex-1 text-xs" title={selectedName}><strong className="block truncate">{selectedName} · {selected.width}×{selected.height}</strong><span className="text-[#64748B]">Dra i kantane for å endre storleik.</span></span>
      <button aria-label="Flytt feltet" aria-pressed={moveArmed} onClick={() => armMove(selectedBlock)} className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs ${moveArmed?'bg-primary text-white':''}`}><Move className="mr-1 inline h-4 w-4" />Flytt</button>
      <button aria-label="Slett feltet" onClick={() => deleteBlock(selectedBlock)} className="min-h-11 shrink-0 rounded-lg border border-red-200 px-3 text-xs text-red-600"><Trash2 className="h-4 w-4" /></button>
    </div>}
    </div>
    <div className="mt-3 flex justify-between text-xs text-[#94A3B8]"><span>🚪 {t('map.entrance')} · 💳 {t('map.checkout')}</span><span>{blocks.length} seksjonar plasserte</span></div>
    {dragging?.edge==='move' && <div ref={binRef} role="region" aria-label="Slepp feltet her for å slette" className={`fixed bottom-24 left-1/2 z-[90] flex min-h-16 w-60 -translate-x-1/2 items-center justify-center gap-2 rounded-xl border-2 border-dashed shadow-lg ${overBin?'border-red-700 bg-red-600 text-white':'border-red-400 bg-red-50 text-red-700'}`}><Trash2 className="h-6 w-6" />Slepp her for å slette</div>}
    {dragging?.edge==='move' && dragPoint && <div className="pointer-events-none fixed z-[95] rounded-lg bg-slate-800/80 px-3 py-2 text-xs text-white" style={{left:dragPoint.x+16,top:dragPoint.y-40}}>{sectionMap[dragging.block.section_id]?.name_nn}</div>}
    {menu && editing && <>
      <div className="fixed inset-0 z-[70]" onPointerDown={()=>setMenu(null)} />
      <div role="menu" aria-label="Val for feltet" className="fixed z-[80] w-52 rounded-xl border bg-white p-1 shadow-xl" style={{left:menu.x,top:menu.y}}>
        <button role="menuitem" onClick={()=>armMove(menu.index)} className="block min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-slate-100">Flytt feltet</button>
        <button role="menuitem" onClick={()=>deleteBlock(menu.index)} className="block min-h-11 w-full rounded-lg px-3 text-left text-sm text-red-600 hover:bg-red-50">Slett feltet</button>
        <button role="menuitem" onClick={()=>setMenu(null)} className="block min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-slate-100">Lukk</button>
      </div>
    </>}
    <dialog ref={paletteRef} aria-labelledby="map-section-title" onCancel={() => { setPaletteOpen(false); setCellSelection(null) }} onClose={() => { setPaletteOpen(false); setCellSelection(null) }}
      className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] top-auto m-auto max-h-[60dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-xl border bg-white p-4 shadow-xl backdrop:bg-black/30">
      <div className="mb-3 flex items-center gap-2"><h2 id="map-section-title" className="flex-1 font-semibold">Vel varegruppe</h2><button autoFocus aria-label="Avbryt" onClick={() => { setPaletteOpen(false); setCellSelection(null) }} className="flex h-11 w-11 items-center justify-center rounded-lg border"><X className="h-5 w-5" /></button></div>
      <div className="grid grid-cols-2 gap-2">{sections.map(s => <button key={s.id} onClick={() => placeAtSelection(s.id)} className="min-h-11 rounded-lg px-3 py-2 text-left text-sm font-medium" style={{backgroundColor:s.color+'20'}}>{s.icon} {s.name_nn}</button>)}</div>
    </dialog>
  </div>
}
