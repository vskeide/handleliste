import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE_NAME } from '@/lib/constants'
import { NavBar } from '@/components/nav-bar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies()
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!session) {
    redirect('/')
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-20">
      {children}
      <NavBar />
    </div>
  )
}
