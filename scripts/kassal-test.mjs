// Quick Kassalapp API check. Run from the project folder:
//   node scripts/kassal-test.mjs
// Reads KASSALAPP_API_KEY from .env.local; never prints the key.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const key = env.KASSALAPP_API_KEY
if (!key) { console.error('KASSALAPP_API_KEY missing in .env.local'); process.exit(1) }

async function k(path) {
  const r = await fetch(`https://kassal.app/api/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

let firstEan = null
for (const q of ['paprika', 'kjøttdeig', 'lettmelk']) {
  console.log(`\n== ${q}`)
  const d = await k(`products?search=${encodeURIComponent(q)}&size=8&unique=1`)
  for (const p of d.data) {
    firstEan ??= p.ean
    const cats = (p.category || []).map((c) => c.name).join(' > ')
    console.log(` | ${p.name} | ${p.brand ?? ''} | ${p.weight ?? ''} ${p.weight_unit ?? ''} | ${p.store?.name ?? ''} ${p.current_price ?? ''} kr | ean ${p.ean ?? '-'} | cat ${cats || '-'}`)
  }
}

if (firstEan) {
  console.log(`\n== barcode ${firstEan}`)
  const d = await k(`products/ean/${firstEan}`)
  const prods = d.data?.products ?? []
  console.log(` ${d.data?.products?.[0]?.name ?? ''}: ${prods.length} shop listings`)
  for (const p of prods) console.log(`  ${p.store?.name}: ${p.current_price?.price ?? p.current_price ?? '-'} kr`)
}

console.log('\n== shops within 3 km of Volda centre')
const s = await k('physical-stores?lat=62.1467&lng=6.0714&km=3&size=20')
for (const st of s.data) console.log(` | ${st.name} | ${st.group} | ${st.address ?? ''} | ${st.position?.lat}, ${st.position?.lng}`)
