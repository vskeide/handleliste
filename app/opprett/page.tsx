'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createHousehold } from '@/lib/actions/auth'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function CreateHouseholdPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [householdCode, setHouseholdCode] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (pin !== confirmPin) {
      setError('PIN-kodane er ikkje like')
      return
    }

    setLoading(true)
    const result = await createHousehold(name, pin)
    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }

    if (result.household) {
      setHouseholdCode(result.household.household_code)
    }
  }

  if (householdCode) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-[#FAFAFA]">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-bold text-[#0F172A]">{t('auth.code_label')}</h1>
          <div className="rounded-xl bg-white p-6 shadow-sm border">
            <p className="text-4xl font-mono font-bold tracking-wider text-primary">
              {householdCode}
            </p>
          </div>
          <p className="text-sm text-[#64748B]">{t('auth.code_share')}</p>
          <Button onClick={() => router.push('/lister')} className="w-full h-12">
            {t('lists.title')}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-[#FAFAFA]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[#64748B] hover:text-[#0F172A]">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-[#0F172A]">{t('welcome.create')}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#0F172A]">
              {t('auth.household_name')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Familien Hansen"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#0F172A]">
              {t('auth.set_pin')}
            </label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="1234"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#0F172A]">
              {t('auth.confirm_pin')}
            </label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="1234"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full h-12" disabled={loading}>
            {loading ? 'Opprettar...' : t('welcome.create')}
          </Button>
        </form>
      </div>
    </main>
  )
}
