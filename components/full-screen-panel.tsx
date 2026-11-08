'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useBodyScrollLock } from '@/lib/hooks/use-body-scroll-lock'

/** Native top-layer modal: background controls stay inert and cannot scroll into view. */
export function FullScreenPanel({ children, label, onClose, className = '' }: {
  children: ReactNode; label: string; onClose: () => void; className?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useBodyScrollLock()
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }, [])
  return <dialog ref={dialog} aria-label={label} onClose={onClose}
    className={`fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-white p-0 text-[#0F172A] overscroll-none backdrop:bg-white ${className}`}>
    {children}
  </dialog>
}
