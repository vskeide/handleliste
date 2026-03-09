'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShoppingCart, Store, Settings } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/lister', label: () => t('nav.lists'), icon: ShoppingCart },
  { href: '/butikkar', label: () => t('nav.stores'), icon: Store },
  { href: '/innstillingar', label: () => t('nav.settings'), icon: Settings },
]

export function NavBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white safe-area-bottom">
      <div className="mx-auto flex max-w-lg items-center justify-around">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors',
                isActive ? 'text-primary font-medium' : 'text-[#94A3B8]'
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label()}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
