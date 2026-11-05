import { readSession } from '@/lib/session'
import { validateAuthorization } from '@/lib/connector/auth'
import { connectorConsent, connectorLogin } from './actions'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Kople til Handleliste', robots: { index: false, follow: false } }

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams, params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach(v => params.append(key, v))
    else if (value) params.set(key, value)
  }
  let authorization
  try { authorization = await validateAuthorization(params) } catch {
    return <main className="mx-auto max-w-md p-6"><h1 className="text-xl font-bold">Kan ikkje kople til</h1><p className="mt-3">Lenkja er ugyldig eller tenesta er mellombels utilgjengeleg. Start tilkoplinga på nytt frå ChatGPT eller Claude.</p></main>
  }
  const household = await readSession(), { client, request } = authorization
  const permissions = request.scope.split(' ')
  params.delete('notice')
  return <main className="mx-auto max-w-md p-6">
    <h1 className="text-2xl font-bold">Kople til Handleliste</h1>
    <p className="mt-3"><strong>{client.name}</strong> ber om tilgang til husstanden din.</p>
    <p className="mt-2 text-sm text-slate-600">Tilgang for: {new URL(request.redirect_uri).hostname}. Berre godkjenn dersom du sjølv starta dette frå ChatGPT eller Claude.</p>
    {!household ? <form action={connectorLogin} className="mt-6 space-y-4">
      <input type="hidden" name="request" value={params.toString()} />
      <label className="block">Husstandskode<input required name="code" autoComplete="username" placeholder="VOLDA-1234" className="mt-1 block w-full rounded border p-3" maxLength={30} /></label>
      <label className="block">PIN<input required name="pin" type="password" inputMode="numeric" autoComplete="current-password" className="mt-1 block w-full rounded border p-3" maxLength={6} /></label>
      {typeof query.notice === 'string' && <p role="alert" className="text-red-600">{query.notice.slice(0, 200)}</p>}
      <button className="min-h-11 w-full rounded bg-slate-900 p-3 text-white">Logg inn</button>
      <p className="text-sm text-slate-600">PIN-koden blir berre send til Handleliste.</p>
    </form> : <form action={connectorConsent} className="mt-6 space-y-4">
      <input type="hidden" name="request" value={params.toString()} />
      <ul className="list-disc space-y-2 pl-5">
        {permissions.includes('lists:read') && <li>Lese lister og middagar</li>}
        {permissions.includes('lists:write') && <li>Leggje varer og middagar til i ei vald liste</li>}
        {permissions.includes('meals:write') && <li>Lagre middagar med ingrediensar</li>}
      </ul>
      <p className="text-sm text-slate-600">Assistenten får ikkje PIN-koden din og kan ikkje slette lister. Du kan trekkje tilbake tilgangen under Innstillingar.</p>
      <button name="decision" value="approve" className="min-h-11 w-full rounded bg-slate-900 p-3 text-white">Godkjenn tilkopling</button>
      <button name="decision" value="deny" className="min-h-11 w-full rounded border p-3">Avbryt</button>
    </form>}
  </main>
}
