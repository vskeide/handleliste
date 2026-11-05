import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { RegisterServiceWorker } from '@/components/register-sw'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Handleliste',
  description: 'Smart handleliste for norske butikkar',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-180.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'Handleliste', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  themeColor: '#3B82F6',
  width: 'device-width',
  initialScale: 1,
  // Android Chrome: shrink the page when the keyboard opens, so bottom-fixed bars
  // move up with it (iOS is handled by useKeyboardViewport)
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="nn">
      <body className={inter.className}>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  )
}
