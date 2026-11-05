import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { resource } from '@/lib/connector/security'
import { revokeConnection } from './actions'

export default async function AssistantConnections() {
  const household = await requireSession()
  const { data, error } = await createServiceRoleClient().from('connector_connections').select('id, client_name, created_at, refresh_expires_at')
    .eq('household_id', household).is('revoked_at', null).gt('refresh_expires_at', new Date().toISOString()).order('created_at', { ascending: false })
  return <main className="mx-auto max-w-lg space-y-5 px-4 py-6">
    <Link href="/innstillingar" className="text-blue-700 underline">Tilbake til innstillingar</Link>
    <h1 className="text-2xl font-bold">ChatGPT og Claude</h1>
    <p>Legg til ein eigen MCP-tenar i assistenten din, og bruk denne adressa:</p>
    <code className="block break-all rounded border bg-white p-3">{resource()}</code>
    <Link href="/connect" className="inline-block text-blue-700 underline">Slik koplar du til</Link>
    <p className="text-sm text-slate-600">Kvar tilkopling får eigen tilgang. Du kan fjerne han her utan å endre PIN-koden. Du bruker abonnementet ditt hos assistenten.</p>
    <h2 className="text-lg font-semibold">Tilkoplingar</h2>
    {error ? <p role="alert">Kunne ikkje hente tilkoplingane. Prøv igjen seinare.</p> : !data?.length ? <p>Ingen tilkoplingar enno.</p> :
      data.map(connection => <form key={connection.id} action={revokeConnection} className="flex items-center gap-3 rounded border bg-white p-3">
        <input type="hidden" name="connection_id" value={connection.id} />
        <div className="flex-1"><p className="font-medium">{connection.client_name}</p><p className="text-xs text-slate-500">Kopla til {new Date(connection.created_at).toLocaleDateString('nn-NO', { timeZone: 'Europe/Oslo' })}</p></div>
        <button className="min-h-11 rounded border border-red-200 px-3 text-sm text-red-700">Fjern tilgang</button>
      </form>)}
  </main>
}
