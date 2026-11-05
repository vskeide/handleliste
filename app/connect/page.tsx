import Link from 'next/link'
import { resource } from '@/lib/connector/security'
export default function ConnectorInfo() {
  return <main className="mx-auto max-w-lg space-y-5 p-6">
    <h1 className="text-2xl font-bold">Handleliste i ChatGPT og Claude</h1>
    <p>Legg til Handleliste som ei eiga tilkopling i ChatGPT eller Claude. Bruk denne adressa:</p>
    <code className="block break-all rounded border bg-white p-3">{resource()}</code>
    <ol className="list-decimal space-y-3 pl-5"><li>Vel å leggje til ein eigen MCP-tenar i ChatGPT, eller ei eiga tilkopling i Claude.</li><li>Lim inn adressa og vel OAuth dersom du blir spurd.</li><li>Logg inn på Handleliste-sida som opnar seg, og godkjenn tilgangen.</li></ol>
    <p>Du kan leggje til varer, lagre middagar og leggje ingrediensar i ei bestemt liste. Assistenten bruker abonnementet ditt. Handleliste gjer ingen AI-kall.</p>
    <p>Prøv: «Vis listene mine» eller «Lagre denne oppskrifta som ein middag og legg ingrediensane i Vekohandel».</p>
    <Link className="inline-block text-blue-700 underline" href="/innstillingar/assistentar">Sjå og fjern tilkoplingar</Link>
  </main>
}
