'use client'

import { useEffect } from 'react'

/** Registers the service worker (public/sw.js) in production builds only. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not fatal: the app works without it, just not offline
    })
  }, [])
  return null
}
