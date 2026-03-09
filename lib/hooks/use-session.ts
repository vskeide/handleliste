'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Household } from '@/lib/types'

export function useSession() {
  const [household, setHousehold] = useState<Household | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch('/api/session')
        if (res.ok) {
          const data = await res.json()
          setHousehold(data.household)
        }
      } catch {
        // Not logged in
      } finally {
        setLoading(false)
      }
    }
    fetchSession()
  }, [])

  return { household, loading }
}
