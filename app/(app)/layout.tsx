import { NavBar } from '@/components/nav-bar'
import { requireSession } from '@/lib/session'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession()

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-20">
      {children}
      <NavBar />
    </div>
  )
}
