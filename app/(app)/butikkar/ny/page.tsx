import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireSession } from '@/lib/session'
import { NewStoreForm } from './new-store-form'

export default async function NewStorePage() {
  await requireSession()
  return <div className="mx-auto max-w-lg px-4 pt-6 pb-24">
    <div className="mb-6 flex items-center gap-3">
      <Link href="/butikkar" aria-label="Tilbake til butikkane" className="flex h-11 w-11 items-center justify-center text-[#64748B]"><ArrowLeft className="h-5 w-5" /></Link>
      <h1 className="text-xl font-bold">Legg til butikk</h1>
    </div>
    <p className="mb-5 text-sm text-[#64748B]">Butikken blir lagd til husstanden din. De og administratorane kan tilpasse kartet.</p>
    <NewStoreForm />
  </div>
}
