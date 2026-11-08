'use client'

import { useEffect, useState } from 'react'

/** Keep an explicitly requested screen lock across foreground/background changes. */
export function useScreenAwake(initialEnabled = false) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [supported, setSupported] = useState(false)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setSupported('wakeLock' in navigator) }, [])
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return
    let disposed = false, pending = false, lock: WakeLockSentinel | null = null
    async function acquire() {
      if (disposed || pending || document.visibilityState !== 'visible' || (lock && !lock.released)) return
      pending = true
      try {
        const next = await navigator.wakeLock.request('screen')
        if (disposed) { await next.release(); return }
        lock = next; setActive(true); setError(null)
        next.addEventListener('release', () => { if (!disposed && lock === next) { lock = null; setActive(false) } })
      } catch {
        if (!disposed && document.visibilityState === 'visible') { setError('Kunne ikkje halde skjermen på. Prøv igjen.'); setEnabled(false); setActive(false) }
      } finally { pending = false }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire() }
    document.addEventListener('visibilitychange', onVisible)
    void acquire()
    return () => {
      disposed = true; document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
      setActive(false)
    }
  }, [enabled])
  return { enabled, setEnabled, supported, active, error }
}
