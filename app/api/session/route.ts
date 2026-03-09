import { cookies } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { NextResponse } from 'next/server'

export async function GET() {
  const cookieStore = cookies()
  const householdId = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!householdId) {
    return NextResponse.json({ household: null }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('households')
    .select('*')
    .eq('id', householdId)
    .single()

  if (!data) {
    return NextResponse.json({ household: null }, { status: 401 })
  }

  // Don't expose pin_hash to client
  const { pin_hash, ...household } = data
  return NextResponse.json({ household })
}
