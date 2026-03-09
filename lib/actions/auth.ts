'use server'

import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/constants'

function generateHouseholdCode(): string {
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `VOLDA-${suffix}`
}

export async function createHousehold(name: string, pin: string) {
  if (!name.trim()) return { error: 'Namn er påkrevd' }
  if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
    return { error: 'PIN må vere 4-6 siffer' }
  }

  const supabase = createServiceRoleClient()
  const pinHash = await bcrypt.hash(pin, 10)

  // Check if this is the first household (make admin)
  const { count } = await supabase
    .from('households')
    .select('*', { count: 'exact', head: true })

  let code = generateHouseholdCode()
  // Ensure unique code
  for (let i = 0; i < 10; i++) {
    const { data: existing } = await supabase
      .from('households')
      .select('id')
      .eq('household_code', code)
      .single()
    if (!existing) break
    code = generateHouseholdCode()
  }

  const { data: household, error } = await supabase
    .from('households')
    .insert({
      name: name.trim(),
      pin_hash: pinHash,
      household_code: code,
      is_admin: (count ?? 0) === 0,
    })
    .select()
    .single()

  if (error) return { error: 'Kunne ikkje opprette husstand' }

  // Add all Volda stores to this household
  const { data: stores } = await supabase
    .from('stores')
    .select('id')
    .eq('city', 'Volda')

  if (stores && stores.length > 0) {
    await supabase.from('household_stores').insert(
      stores.map((s: { id: string }) => ({
        household_id: household.id,
        store_id: s.id,
      }))
    )
  }

  // Pre-seed 215 items for this household
  await seedHouseholdItems(supabase, household.id)

  // Set session cookie
  setSessionCookie(household.id)

  return { household }
}

export async function joinHousehold(code: string, pin: string) {
  if (!code.trim()) return { error: 'Husstandskode er påkrevd' }
  if (!pin) return { error: 'PIN er påkrevd' }

  const supabase = createServiceRoleClient()

  const { data: household, error } = await supabase
    .from('households')
    .select('*')
    .eq('household_code', code.trim().toUpperCase())
    .single()

  if (error || !household) return { error: 'Fann ikkje husstand' }

  const valid = await bcrypt.compare(pin, household.pin_hash)
  if (!valid) return { error: 'Feil PIN-kode' }

  setSessionCookie(household.id)

  return { household }
}

export async function logout() {
  cookies().set(SESSION_COOKIE_NAME, '', { maxAge: 0, path: '/' })
}

export async function getSession(): Promise<string | null> {
  const cookieStore = cookies()
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
}

export async function getHousehold() {
  const householdId = await getSession()
  if (!householdId) return null

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('households')
    .select('*')
    .eq('id', householdId)
    .single()

  return data
}

function setSessionCookie(householdId: string) {
  cookies().set(SESSION_COOKIE_NAME, householdId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
}

async function seedHouseholdItems(supabase: ReturnType<typeof createServiceRoleClient>, householdId: string) {
  const { data: sections } = await supabase
    .from('sections')
    .select('id, name_nn')

  if (!sections) return

  const sectionMap: Record<string, string> = {}
  sections.forEach((s: { id: string; name_nn: string }) => { sectionMap[s.name_nn] = s.id })

  const itemsBySection: Record<string, string[]> = {
    'Frukt & grønt': ['Banan', 'Eple', 'Appelsin', 'Sitron', 'Avokado', 'Tomat', 'Agurk', 'Paprika', 'Løk', 'Raudløk', 'Kvitløk', 'Potet', 'Gulrot', 'Brokkoli', 'Blomkål', 'Salat', 'Spinat', 'Sopp', 'Mais', 'Ingefær', 'Lime', 'Mango', 'Druer', 'Jordbær', 'Blåbær'],
    'Brød & bakeri': ['Grovbrød', 'Kneippbrød', 'Loff', 'Rundstykke', 'Polarbrød', 'Lefse', 'Knekkebrød', 'Pitabrød', 'Hamburgarbrød', 'Pølsebrød', 'Tortillalefser', 'Bagett', 'Ciabatta', 'Kanelbollar', 'Skulebrød'],
    'Pålegg & frukost': ['Brunost', 'Norvegia', 'Jarlsberg', 'Gulost skiva', 'Leverpostei', 'Servelat', 'Salami', 'Skinke', 'Makrell i tomat', 'Kaviar (Mills)', 'Nugatti', 'Syltetøy', 'Honning', 'Peanøttsmør', 'Havregryn', 'Cornflakes', 'Müsli', 'Egg', 'Bacon', 'Yoghurt (Skyr)'],
    'Meieri': ['Lettmjølk', 'Helmjølk', 'Skumma mjølk', 'Sjokolademjølk', 'Fløte (lett)', 'Kremfløte', 'Rømme', 'Crème fraîche', 'Smør', 'Margarin (Soft)', 'Egg (økologisk)', 'Cottage cheese', 'Mozzarella', 'Parmesan', 'Kremost (Philadelphia)', 'Yoghurt natur', 'Go\'morgen yoghurt', 'Biola', 'Kulturmjølk', 'Matfløte'],
    'Kjøt & fisk': ['Kyllingfilet', 'Kyllinglår', 'Karbonadedeig', 'Kjøtdeig', 'Svinekotelett', 'Svinekjøt (strimlar)', 'Biff', 'Pølser (Gilde)', 'Wienerpølser', 'Laks (fersk)', 'Laksfilet (frosen)', 'Torsk', 'Sei', 'Reker', 'Kyllingpålegg', 'Spekeskinke', 'Fenalår', 'Pinnekjøt', 'Ribbe', 'Medisterkaker', 'Fiskekaker', 'Fiskepinnar'],
    'Frysevarer': ['Frosenpizza', 'Frosne grønsaker', 'Pommes frites', 'Diplom-Is', 'Hennig-Olsen Is', 'Fiskepinnar (frosne)', 'Frosne bær', 'Lasagne (frosen)', 'Kyllingnuggets', 'Fyrstekake (frosen)', 'Brød (frose)', 'Vaflar (frosne)', 'Frosne reker', 'Frose laksfilet', 'Pai (frosen)', 'Rundstykke (frosne)', 'Pizzadeig (frosen)', 'Frosne erter'],
    'Tørrvarer & hermetikk': ['Pasta (spaghetti)', 'Pasta (penne)', 'Ris (jasmin)', 'Ris (basmati)', 'Nudlar', 'Hakkede tomatar', 'Tomatsaus', 'Ketchup', 'Sennep', 'Majones', 'Soyasaus', 'Olivenolje', 'Rapsolje', 'Kveitemjøl', 'Sukker', 'Salt', 'Pepper', 'Buljong (terningar)', 'Kokosmjølk', 'Kidneybonar', 'Kikerter', 'Linser', 'Tacokrydder', 'Tacoskjel', 'Tacosaus'],
    'Drikke': ['Appelsinjuice', 'Eplejuice', 'Vatn (Imsdal)', 'Cola', 'Solo', 'Fanta', 'Mineralvatn (Farris)', 'Kaffi (filterkaffi)', 'Kaffi (kapslar)', 'Te', 'Fun Light', 'Hushaldningssaft', 'Energidrikk', 'Øl (alkoholfritt)', 'Havremjølk'],
    'Snacks & godteri': ['Potetgull (Maarud)', 'Freia Mjølkesjokolade', 'Kvikk Lunsj', 'Smash', 'Nøtter (blanding)', 'Twist', 'Non Stop', 'Seigmenn', 'Lakris', 'Kjeks (Digestive)', 'Smågodt', 'Popkorn', 'Ostepop', 'Sjokoladekjeks', 'Tørka frukt'],
    'Hushaldning & reinhald': ['Oppvaskmiddel', 'Vaskemiddel (tøy)', 'Tøymjuknar', 'Toalettpapir', 'Tørkepapir', 'Søppelposar', 'Alufolie', 'Plastfolie', 'Fryseposar', 'Oppvaskmaskin-tabs', 'Klutar/svampar', 'Reingjøringsmiddel (allreint)', 'Bleikmiddel', 'Stearinlys', 'Fyrstikker'],
    'Personleg pleie': ['Sjampo', 'Balsam', 'Tannkrem', 'Tannbørste', 'Deodorant', 'Handsåpe', 'Dusjsåpe', 'Bodylotion', 'Barberskum', 'Bomullspads', 'Tampongar/bind', 'Solkrem', 'Leppepomade', 'Plaster', 'Smertestillande (Paracet)'],
    'Barnemat & bleier': ['Bleier', 'Våtserviettar', 'Barnemat (glas)', 'Barnemat (pose)', 'Barnegraut', 'Morsmjølkerstatning', 'Smokk', 'Tåteflaske', 'Barneyoghurt', 'Fruktmos (barn)'],
    'Baking': ['Hvetemel', 'Sukker', 'Gjær', 'Bakepulver', 'Vaniljesukker', 'Natron', 'Melis', 'Kokosmel', 'Kakaopulver', 'Sjokolade (baking)'],
  }

  const allItems: { household_id: string; name: string; section_id: string; is_confirmed: boolean }[] = []

  for (const [sectionName, items] of Object.entries(itemsBySection)) {
    const sectionId = sectionMap[sectionName]
    if (!sectionId) continue
    for (const itemName of items) {
      allItems.push({
        household_id: householdId,
        name: itemName,
        section_id: sectionId,
        is_confirmed: true,
      })
    }
  }

  // Insert in batches of 50
  for (let i = 0; i < allItems.length; i += 50) {
    await supabase.from('items').insert(allItems.slice(i, i + 50))
  }
}
