'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { logout } from '@/lib/actions/auth'
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
    is_admin: boolean
  }
}

export function SettingsClient({ household }: Props) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)

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

          <div>
            <label className="text-xs text-[#64748B] uppercase tracking-wider">
              {t('settings.family_size')}
            </label>
            <p className="text-lg font-semibold text-[#0F172A] mt-1">{household.family_size}</p>
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
