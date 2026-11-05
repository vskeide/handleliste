'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createStore } from '@/lib/actions/stores'
import { STORE_CHAIN_LABELS } from '@/lib/constants'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function NewStoreForm() {
  const router = useRouter()
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    busy.current = true; setSaving(true); setError(null)
    const form = new FormData(event.currentTarget)
    try {
      const result = await createStore({name:String(form.get('name') ?? ''),chain:String(form.get('chain') ?? ''),city:String(form.get('city') ?? ''),address:String(form.get('address') ?? '')})
      if (!result.storeId) { setError(result.error ?? 'Kunne ikkje opprette butikken.'); return }
      router.push(`/butikkar/${result.storeId}/kart`)
      router.refresh()
    } catch { setError('Kunne ikkje opprette butikken. Kontroller nettilkoplinga og prøv igjen.') }
    finally { busy.current = false; setSaving(false) }
  }
  return <form onSubmit={submit} className="space-y-4">
    <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
      <div><label htmlFor="store-name" className="mb-1 block text-sm font-medium">Namn på butikken</label>
        <Input id="store-name" name="name" placeholder="Til dømes KIWI Ulsteinvik" required maxLength={100} className="h-12" /></div>
      <div><label htmlFor="store-chain" className="mb-1 block text-sm font-medium">Kjede</label>
        <select id="store-chain" name="chain" required defaultValue="" className="h-12 w-full rounded-md border bg-white px-3 text-sm">
          <option value="" disabled>Vel kjede</option>
          {Object.entries(STORE_CHAIN_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
        </select></div>
      <div><label htmlFor="store-city" className="mb-1 block text-sm font-medium">Stad</label>
        <Input id="store-city" name="city" placeholder="Til dømes Ulsteinvik" required maxLength={100} autoComplete="address-level2" className="h-12" /></div>
      <div><label htmlFor="store-address" className="mb-1 block text-sm font-medium">Adresse (valfritt)</label>
        <Input id="store-address" name="address" maxLength={200} autoComplete="street-address" className="h-12" /></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <Button type="submit" disabled={saving} className="h-12 w-full">{saving ? 'Lagrar…' : 'Legg til og opne kartet'}</Button>
  </form>
}
