import { NavBar } from '@/components/nav-bar'
import { requireSession } from '@/lib/session'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  requireSession()

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-20">
      {children}
      <NavBar />
    </div>
  )
}
