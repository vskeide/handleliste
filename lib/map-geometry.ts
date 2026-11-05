import type { StoreMapBlock } from './types'
export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom'
export interface Point { x: number; y: number }
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function resizeBlock(b: StoreMapBlock, edge: ResizeEdge, dx: number, dy: number, cols: number, rows: number): StoreMapBlock {
  let left = b.col, right = b.col + b.width, top = b.row, bottom = b.row + b.height
  if (edge === 'left') left = clamp(left + dx, 0, right - 1)
  if (edge === 'right') right = clamp(right + dx, left + 1, cols)
  if (edge === 'top') top = clamp(top + dy, 0, bottom - 1)
  if (edge === 'bottom') bottom = clamp(bottom + dy, top + 1, rows)
  return { ...b, col: left, row: top, width: right - left, height: bottom - top }
}

export function canPlaceBlock(b: StoreMapBlock, blocks: StoreMapBlock[], cols: number, rows: number, exclude = -1): boolean {
  return b.col >= 0 && b.row >= 0 && b.width >= 1 && b.height >= 1 && b.col + b.width <= cols && b.row + b.height <= rows
    && blocks.every((other, i) => i === exclude || !(b.col < other.col + other.width && b.col + b.width > other.col && b.row < other.row + other.height && b.row + b.height > other.row))
}

export function twoFingerFrame(a: Point, b: Point) {
  return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
}

// Keep the same point of the grid under the moving pinch centre, including padding.
export function zoomScroll(anchor: Point, center: Point, zoom: number, viewportWidth: number, cols: number, rows: number, padding = 24) {
  const gridWidth = Math.max(1, viewportWidth * zoom - 2 * padding)
  return { left: padding + anchor.x * gridWidth - center.x, top: padding + anchor.y * gridWidth * rows / cols - center.y }
}
