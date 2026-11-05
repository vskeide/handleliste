import { NextResponse } from 'next/server'
import { getHousehold } from '@/lib/actions/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const household = await getHousehold()
  if (!household) {
    return NextResponse.json({ household: null }, { status: 401 })
  }
  return NextResponse.json({ household })
}
