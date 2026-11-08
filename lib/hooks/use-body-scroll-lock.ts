'use client'

import { useEffect } from 'react'

let locks = 0
let restore: (() => void) | null = null

/** Freeze the page behind a modal, including iOS rubber-band scrolling. */
export function useBodyScrollLock() {
  useEffect(() => {
    if (locks++ === 0) {
      const body = document.body, root = document.documentElement
      const x = window.scrollX, y = window.scrollY
      const before = { position: body.style.position, top: body.style.top, left: body.style.left,
        right: body.style.right, width: body.style.width, overflow: body.style.overflow,
        rootOverflow: root.style.overflow, rootOverscroll: root.style.overscrollBehavior }
      Object.assign(body.style, { position:'fixed', top:`-${y}px`, left:`-${x}px`, right:'0', width:'100%', overflow:'hidden' })
      root.style.overflow = 'hidden'; root.style.overscrollBehavior = 'none'
      restore = () => {
        Object.assign(body.style, { position:before.position, top:before.top, left:before.left,
          right:before.right, width:before.width, overflow:before.overflow })
        root.style.overflow = before.rootOverflow; root.style.overscrollBehavior = before.rootOverscroll
        window.scrollTo(x,y)
      }
    }
    return () => { if (--locks === 0) { restore?.(); restore = null } }
  }, [])
}
