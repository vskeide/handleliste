import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('sections')
    .select('*')
    .order('default_sort_order')

  return NextResponse.json(data || [])
}
