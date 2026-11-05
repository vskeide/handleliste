'use client'

import { useCallback, useEffect, useState } from 'react'

// Which of the household's shops is the phone in? Uses the browser's location (only
// while the app is open; no background tracking). Asks for permission only when the
// user taps the 📍 button, or silently if permission was already given.

export interface StorePoint { id: string; name: string; latitude: number | null; longitude: number | null }

export type GeoState =
  | { status: 'idle' }                                   // not asked
  | { status: 'locating' }
  | { status: 'denied' }                                 // permission refused / unavailable
  | { status: 'at'; storeId: string; distance: number }  // inside a known shop
  | { status: 'between'; storeIds: string[] }            // two shops too close to tell apart
  | { status: 'near' }                                   // close to shops but not clearly in one
  | { status: 'away' }                                   // far from every shop (e.g. at home)

const AWAY_METRES = 600

function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function classify(stores: StorePoint[], lat: number, lng: number, accuracy: number): GeoState {
  const ranked = stores
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => ({ id: s.id, d: metres(lat, lng, s.latitude!, s.longitude!) }))
    .sort((a, b) => a.d - b.d)
  if (!ranked.length) return { status: 'near' }
  // Indoors GPS is rough; allow for the reported accuracy, within sane limits
  const inside = Math.min(250, Math.max(120, accuracy))
  const [first, second] = ranked
  if (first.d <= inside) {
    if (second && second.d <= inside && second.d - first.d < 40) return { status: 'between', storeIds: [first.id, second.id] }
    return { status: 'at', storeId: first.id, distance: Math.round(first.d) }
  }
  return first.d > AWAY_METRES ? { status: 'away' } : { status: 'near' }
}

export function useNearbyStore(stores: StorePoint[]) {
  const [state, setState] = useState<GeoState>({ status: 'idle' })

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setState({ status: 'denied' }); return }
    setState({ status: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (pos) => setState(classify(stores, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)),
      (err) => setState(err.code === err.PERMISSION_DENIED ? { status: 'denied' } : { status: 'near' }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }, [stores])

  // If location is already allowed, check quietly when the list opens and when the
  // app comes back to the front (walking into the shop with the app open)
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
        if (!cancelled && p?.state === 'granted') locate()
      } catch {
        // permissions API missing (older iOS): wait for the button
      }
    }
    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible) }
  }, [locate])

  return { geo: state, locate }
}
