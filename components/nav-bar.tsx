'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, ShoppingCart, Store, Settings, UtensilsCrossed, Sun } from 'lucide-react'
import { t } from '@/lib/i18n'
import { FullScreenPanel } from '@/components/full-screen-panel'
import { useScreenAwake } from '@/lib/hooks/use-screen-awake'
import packageInfo from '@/package.json'

const navItems = [
  { href: '/lister', label: () => t('nav.lists'), icon: ShoppingCart },
  { href: '/middagar', label: () => 'Middagar', icon: UtensilsCrossed },
  { href: '/butikkar', label: () => t('nav.stores'), icon: Store },
  { href: '/innstillingar', label: () => t('nav.settings'), icon: Settings },
]

const MenuContext = createContext<{ open: boolean; show: () => void } | null>(null)

/** Place the shared menu in each page's existing title row. */
export function MenuButton() {
  const menu = useContext(MenuContext)
  if (!menu) return null
  return <button type="button" onClick={menu.show} aria-label="Opne hovudmenyen" aria-haspopup="dialog" aria-expanded={menu.open}
    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#64748B]">
    <Menu className="h-6 w-6" />
  </button>
}

export function NavBar({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [openPath, setOpenPath] = useState<string | null>(null)
  const open = openPath === pathname
  const close = () => setOpenPath(null)
  const screen = useScreenAwake()
  useEffect(() => { setOpenPath(null) }, [pathname])

  return <MenuContext.Provider value={{open,show:() => setOpenPath(pathname)}}>
    {children}
    {open && <FullScreenPanel label="Hovudmeny" onClose={close}>
      <div className="mx-auto flex h-full max-w-lg flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex min-h-16 items-center justify-between border-b">
          <h2 className="text-xl font-bold">Handleliste</h2>
          <button type="button" onClick={close} aria-label="Lukk hovudmenyen" className="flex h-11 w-11 items-center justify-center"><X className="h-6 w-6" /></button>
        </div>
        <nav aria-label="Hovudnavigasjon" className="space-y-2 overflow-y-auto py-6 overscroll-contain">
          {navItems.map(item => {
            const active = pathname.startsWith(item.href), Icon = item.icon
            return <Link key={item.href} href={item.href} onClick={close} aria-current={active ? 'page' : undefined}
              className={`flex min-h-16 items-center gap-4 rounded-xl px-4 text-lg ${active ? 'bg-primary/10 font-semibold text-primary' : 'text-[#64748B] hover:bg-slate-100'}`}>
              <Icon className="h-6 w-6" />{item.label()}
            </Link>
          })}
        </nav>
        <div className="mt-auto border-t pt-4">
          <button type="button" role="switch" aria-label="Hald skjermen på" aria-checked={screen.enabled} disabled={!screen.supported}
            onClick={() => screen.setEnabled(!screen.enabled)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 text-left disabled:opacity-50">
            <Sun className="h-5 w-5" /><span className="flex-1 font-medium">Hald skjermen på</span>
            <span className={`rounded-full px-3 py-1 text-sm ${screen.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{screen.enabled ? screen.active ? 'På' : 'Ventar' : 'Av'}</span>
          </button>
          <p role={screen.error ? 'status' : undefined} className="mt-2 text-xs text-[#64748B]">
            {screen.error ?? (!screen.supported ? 'Nettlesaren støttar ikkje denne funksjonen.' : screen.active ? 'Skjermen blir halden på medan appen er synleg.' : screen.enabled ? 'Vent på at nettlesaren held skjermen på.' : 'Slå på for å hindre at skjermen går i dvale medan appen er synleg.')}
          </p>
          <p className="mt-3 text-xs text-[#94A3B8]">Versjon {packageInfo.version}</p>
        </div>
      </div>
    </FullScreenPanel>}
  </MenuContext.Provider>
}
