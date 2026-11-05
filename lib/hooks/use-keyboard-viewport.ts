'use client'

import { useEffect, useState } from 'react'

// On phones the on-screen keyboard shrinks the *visible* area but not the page, so
// things positioned against the page bottom end up behind the keyboard or pushed off
// the top. This reports the visible area while the keyboard is up, so the add bar can
// sit right above the keyboard and its results fit in what is left.

export interface VisibleArea { top: number; height: number }

export function useKeyboardViewport(): VisibleArea | null {
  const [area, setArea] = useState<VisibleArea | null>(null)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const update = () => {
      const keyboardUp = window.innerHeight - vv.height > 120
      setArea(keyboardUp ? { top: vv.offsetTop, height: vv.height } : null)
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return area
}
