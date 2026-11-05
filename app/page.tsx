import { redirect } from 'next/navigation'
import Link from 'next/link'
import { readSession } from '@/lib/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ShoppingCart } from 'lucide-react'

export const dynamic = 'force-dynamic'

/** The list the household used most recently: last added line, else newest list. */
async function latestListId(householdId: string): Promise<string | null> {
  const supabase = createServiceRoleClient()
  const { data: lists } = await supabase
    .from('shopping_lists')
    .select('id, created_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
  if (!lists?.length) return null
  const { data: line } = await supabase
    .from('list_items')
    .select('list_id')
    .in('list_id', lists.map((l) => l.id))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return line?.list_id ?? lists[0].id
}

export default async function WelcomePage() {
  const householdId = readSession()
  if (householdId) {
    // Open straight on the list in use; the overview stays one tap away
    const id = await latestListId(householdId)
    redirect(id ? `/lister/${id}` : '/lister')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-[#FAFAFA]">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <ShoppingCart className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-[#0F172A]">
            {t('welcome.title')}
          </h1>
          <p className="text-[#64748B]">
            {t('welcome.subtitle')}
          </p>
        </div>

        <div className="space-y-3">
          <Button asChild className="w-full h-12 text-base">
            <Link href="/opprett">{t('welcome.create')}</Link>
          </Button>
          <Button asChild variant="outline" className="w-full h-12 text-base">
            <Link href="/bli-med">{t('welcome.join')}</Link>
          </Button>
        </div>

        <p className="text-sm text-[#94A3B8]">
          {t('welcome.share_hint')}
        </p>
      </div>
    </main>
  )
}
