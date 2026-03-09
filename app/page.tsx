import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ShoppingCart } from 'lucide-react'

export default function WelcomePage() {
  const cookieStore = cookies()
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (session) {
    redirect('/lister')
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
