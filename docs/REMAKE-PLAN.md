# Handleliste — remake plan

Written 2026-11-05 after an audit of the code (≈4 800 lines, Next.js 14 + Supabase) and the
live database. Goal: an app that is fast enough and simple enough that it actually gets used.
Phase 1 users: Vebjørn and his wife (one household). Built so other households can be added
later without a rebuild.

## 1. What already exists

| Area | Status | Where |
|---|---|---|
| Households with code + PIN (bcrypt) | Works, but insecure (see §2) | `lib/actions/auth.ts`, `app/opprett`, `app/bli-med` |
| Lists, add/tick/remove items, quantities (stk, g, kg, dl, L, ml, pakke, porsjon) | Works, add is slow | `app/(app)/lister/[id]/list-detail-client.tsx`, `lib/actions/lists.ts`, `components/quantity-picker-sheet.tsx` |
| Live sync between phones | Works (Supabase Realtime on `list_items`) | `lib/hooks/use-realtime-list.ts` |
| 18 sections, ~215 starter items seeded per household | Works | `seedHouseholdItems` in `auth.ts` |
| Two view modes: by section / "Frihandel" (flat, learned order) | Works | `list-detail-client.tsx` |
| Learned order: `check_order_sum / check_count` per item | Exists, but one global order per item — not per shop | `toggleListItem` in `lists.ts` |
| Shop walk order: household override → shared default → section default | Exists | `getWalkOrder` in `lib/actions/stores.ts` |
| Shop grid map editor (587 lines) | Exists, heavy | `app/(app)/butikkar/[id]/kart` |
| Meals (3 saved) → add all to list | Exists, no scaling by people | `lib/actions/meals.ts`, `app/(app)/middagar` |
| Templates ("Lagre som mal") | Exists | `lists.ts` |
| PWA manifest | Present, but icons missing (`public/icons/` does not exist), no service worker | `public/manifest.json` |
| Keep-alive cron | Added 2026-11-05 | `app/api/keepalive`, `vercel.json` |
| Database schema in repo | **Missing** — tables exist only in Supabase | — |

Data in Supabase (2026-11-05): 3 households, 657 items, 16 lists, 163 list lines, 9 shops
(Volda), 3 meals, 18 shared walk-order rows, 1 shop map. Household 3 (`VOLDA-6611`, created
2026-11-05 12:45 UTC) looks like a household code typed into the *create* form by mistake.

## 2. Problems found

### Security (fix first — the app and repo are public)
1. **The public browser key can read every table.** With `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (shipped in the page) anyone can read `households` (incl. `pin_hash` and ids), all
   items, lists and meals. Row Level Security is off or open. Writes not tested.
2. **The session cookie is the raw household id, unsigned.** Anyone who has an id (see 1)
   can set the cookie and act as that household.
3. **A 4-digit PIN with no attempt limit.** Brute-forceable online in minutes, and the
   bcrypt hash cracks offline instantly once read via (1).
4. Several actions (`toggleListItem`, `removeListItem`, `updateListItemQuantity`,
   `removeMealItem`, `updateMealItemQuantity`) update by row id without checking the row
   belongs to the logged-in household.

### Speed — why "add + Enter" feels slow
1. **Adding is not optimistic.** `handleAddItem` waits for the server action before the
   item appears; only tick/remove/quantity are optimistic.
2. **Two sequential DB calls per add** (check-exists, then insert); a new item is four
   (create item → add to list), plus a section-picker step in between.
3. **Server round-trip on every keystroke** for search (`searchItems`), no debounce.
   Pressing Enter before results arrive opens "create new item" instead of adding the match.
4. **Every add refetches all ~650 household items** (`getHouseholdItems` runs whenever
   `listItems.length` changes).
5. **Server far away.** Functions run in Vercel `iad1` (Washington DC); a phone in Volda
   pays the transatlantic round-trip on every action. DB round-trip from Volda ≈105 ms.

### Usability
- Opening the app lands on `/lister` (all lists), not on the current list.
- New items must be placed in a section by hand.
- Learned order is the same in every shop.
- Meals don't scale to the number of people; no "same as last time".
- Join vs create household is easy to mix up (see household 3).

## 3. Target design

**One screen:** the active list opens straight away, add field pinned at the bottom,
everything else behind a menu. All actions show instantly and sync in the background.

| Feature | Design |
|---|---|
| Instant UI | Whole household catalogue + active list cached on the phone (IndexedDB); search runs locally; every write optimistic with a client-generated id; sync queue retries when offline |
| Autocomplete | Local fuzzy search over household items + product catalogue with variants (paprika rød/grønn/gul) and a default unit per product |
| Quick add | Free text "mjølk, 2 kg potet, taco" split into lines (AI only for the hard cases); merge with existing lines (1 løk + 2 løk = 3 løk) |
| Sections | Every catalogue product carries its section; new free-text items get one from AI, user can move with one tap |
| Shop detection | GPS on open (foreground only) → nearest known shop within ~100 m; ask when two shops are close; Kassalapp `physical-stores` as shop source |
| Route learning | Per shop: record tick order of *sections* (shared) and *items* (household); average with decay |
| View modes | **Auto-route** (flat, learned order) / **By section** (grouped). Default by section in an unknown shop, auto-route once learned |
| Shared layouts | Section order per shop averaged across households (≥3 trips from ≥2 households before used); never shares list contents |
| Meals | ~50 starter dinners seeded, each for N people, scaled to `family_size`; side panel to add/edit recipes; paste-a-recipe → AI parses ingredients |
| Repeat | "Same as last time" and a row of frequent items |
| AI connector | MCP endpoint on the same Vercel app: `add_items`, `get_list`, `add_meal`; own revocable token, not the PIN |
| Prices (later) | Kassalapp product search/EAN; non-commercial (Hobby tier) only |
| Install | Real PWA: icons, service worker, opens on the active list |

**Not doing:** background geofencing (impossible in a web app); scraping webshops (terms
and database rights); the grid map editor stays but is no longer needed for sorting.

## 4. Phases

### Phase 0 — Security and foundation (small, do first)
- Schema into the repo: dump current tables to `supabase/migrations/0001_baseline.sql`.
- Enable RLS on all tables; the browser gets no direct table access (realtime via a
  household-scoped channel or a signed token).
- Signed session cookie (HMAC with a server secret) instead of the raw id; rate-limit PIN
  attempts; allow 6+ digit PINs.
- Ownership check in every action that takes a row id.
- Pin Vercel functions to an EU region next to Supabase (`vercel.json` → `"regions"`),
  after confirming the Supabase region in the dashboard.
- Clean up household `VOLDA-6611` (ask first).

### Phase 1 — Speed and the one-screen list
- Optimistic add with client ids; single upsert per add (unique `(list_id, item_id)`).
- Local search over a cached catalogue; Enter adds the top match instantly.
- Stop refetching all items on every add.
- App opens on the active list; add field pinned at the bottom.
- PWA icons + service worker; offline read and queued writes.

### Phase 2 — Catalogue and meals
- Product catalogue (~500 generic items with variants, section, default unit).
- Free-text multi-add and line merging.
- ~50 starter meals for N people, scaled; recipe side panel; "same as last time".

### Phase 3 — Shops and routes
- GPS shop detection with "save this shop" and Kassalapp shop lookup.
- Per-shop route learning (items per household, sections shared); the two view modes.

### Phase 4 — AI connector
- MCP endpoint with token auth; tested from the Claude app (voice) and ChatGPT.

### Phase 5 — Opening up (later)
- Personal logins (email link) on top of households; shared layouts across households;
  Kassalapp prices.

## 5. Open questions
- Supabase region (Settings → General) — decides the Vercel region.
- Which household is the real one? #1 "Krumsvik Skeide" (09.03 09:13): 3 lists, 244 items,
  1 meal. #2 "Krumsvik Skeide" (09.03 10:26): 12 lists, 228 items, 2 meals. #3 `VOLDA-6611`
  (05.11): 2 lists ("Storhandel" ×2), 185 items, 0 meals. Proposal: keep #2, merge #1's
  meal and #3's lists into it, then remove #1 and #3.
- Kassalapp smoke test output (`node scripts/kassal-test.mjs`) still pending.
