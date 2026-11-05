import { requireSession } from '@/lib/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { t } from '@/lib/i18n'
import { SettingsClient } from './settings-client'

export default async function SettingsPage() {
  const householdId = requireSession()

  const supabase = createServiceRoleClient()
  const { data: household } = await supabase
    .from('households')
    .select('*')
    .eq('id', householdId)
    .single()

  if (!household) return null

  return (
    <SettingsClient
      household={{
        id: household.id,
        name: household.name,
        household_code: household.household_code,
        family_size: household.family_size,
        is_admin: household.is_admin,
      }}
    />
  )
}
