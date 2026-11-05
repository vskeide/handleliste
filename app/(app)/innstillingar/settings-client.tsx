'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { logout, setHouseholdSize } from '@/lib/actions/auth'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { LogOut, Copy, Check } from 'lucide-react'

interface Props {
  household: {
    id: string
    name: string
    household_code: string
    family_size: number
    adults: number | null
    children: number | null
    is_admin: boolean
  }
}

function Stepper({ label, hint, value, min, onChange }: { label: string; hint: string; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-[#0F172A]">{label}</p>
        <p className="text-xs text-[#94A3B8]">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="h-9 w-9 rounded-full border text-lg text-[#64748B] disabled:opacity-30"
          aria-label={`Færre ${label.toLowerCase()}`}
        >−</button>
        <span className="w-6 text-center text-lg font-semibold text-[#0F172A]">{value}</span>
        <button
          onClick={() => onChange(Math.min(20, value + 1))}
          className="h-9 w-9 rounded-full border text-lg text-[#64748B]"
          aria-label={`Fleire ${label.toLowerCase()}`}
        >+</button>
      </div>
    </div>
  )
}

export function SettingsClient({ household }: Props) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [adults, setAdults] = useState(household.adults ?? household.family_size ?? 2)
  const [children, setChildren] = useState(household.children ?? 0)
  const [sizeNote, setSizeNote] = useState<string | null>(null)

  async function saveSize(a: number, c: number) {
    setAdults(a)
    setChildren(c)
    setSizeNote(null)
    const r: any = await setHouseholdSize(a, c)
    if (r?.error) setSizeNote(r.error)
    else if (r?.warning) setSizeNote(r.warning)
    else {
      setSizeNote('Lagra')
      setTimeout(() => setSizeNote(null), 1500)
    }
  }

  async function handleLogout() {
    await logout()
    router.push('/')
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(household.household_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-bold text-[#0F172A] mb-6">{t('settings.title')}</h1>

      <div className="space-y-4">
        {/* Household info */}
        <div className="rounded-xl bg-white p-4 shadow-sm border border-[#E2E8F0] space-y-4">
          <div>
            <label className="text-xs text-[#64748B] uppercase tracking-wider">
              {t('settings.household_name')}
            </label>
            <p className="text-lg font-semibold text-[#0F172A] mt-1">{household.name}</p>
          </div>

          <div>
            <label className="text-xs text-[#64748B] uppercase tracking-wider">
              {t('settings.household_code')}
            </label>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-lg font-mono font-bold text-primary">
                {household.household_code}
              </code>
              <button onClick={handleCopyCode} className="text-[#94A3B8] hover:text-primary">
                {copied ? <Check className="h-4 w-4 text-[#10B981]" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-[#94A3B8] mt-1">{t('auth.code_share')}</p>
          </div>

          <div className="space-y-3">
            <label className="text-xs text-[#64748B] uppercase tracking-wider">
              {t('settings.family_size')}
            </label>
            <Stepper label="Vaksne" hint="13 år og eldre" value={adults} min={1} onChange={(n) => saveSize(n, children)} />
            <Stepper label="Born" hint="Under 13 – tel som ein halv porsjon" value={children} min={0} onChange={(n) => saveSize(adults, n)} />
            <p className="text-xs text-[#94A3B8]">
              Middagar blir skalerte til {adults + children * 0.5} porsjonar.
              {sizeNote && <span className="ml-1 text-[#059669]">{sizeNote}</span>}
            </p>
          </div>

          {household.is_admin && (
            <Badge className="bg-primary/10 text-primary border-0">Admin</Badge>
          )}
        </div>

        {/* Logout */}
        <Button
          onClick={handleLogout}
          variant="outline"
          className="w-full h-12 text-red-600 border-red-200 hover:bg-red-50"
        >
          <LogOut className="h-5 w-5 mr-2" />
          {t('settings.logout')}
        </Button>
      </div>
    </div>
  )
}
