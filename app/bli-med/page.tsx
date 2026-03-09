'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { joinHousehold } from '@/lib/actions/auth'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function JoinHouseholdPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await joinHousehold(code, pin)
    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }

    router.push('/lister')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-[#FAFAFA]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[#64748B] hover:text-[#0F172A]">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-[#0F172A]">{t('welcome.join')}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#0F172A]">
              {t('auth.enter_code')}
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="VOLDA-1234"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#0F172A]">
              {t('auth.enter_pin')}
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

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full h-12" disabled={loading}>
            {loading ? 'Loggar inn...' : t('welcome.join')}
          </Button>
        </form>
      </div>
    </main>
  )
}
