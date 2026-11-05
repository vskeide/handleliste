# Handover: Handleliste remake (2026-11-05)

## Codex follow-up (2026-11-05)

This checkpoint supersedes the original status below:

- Supabase connector is now connected. Project `txppeyposryvacjnclen` is healthy in
  **eu-north-1 (Stockholm)**, confirmed by the project API.
- Applied the existing SQL from **0004 and 0005** through the connector. Verified the
  adults/children columns and both route tables. Route tables have RLS enabled, no
  anon/authenticated CRUD privileges, and service-role access. Security advisors report
  only the expected informational notices for RLS without policies (server-only access).
  Adults and children remain unset; the household must choose the values in settings.
- Map editor: local changes add 100–400% zoom, fit/reset, a scrollable viewport, an
  explicit pan toggle in edit mode, section names on phones, and larger delete controls.
  Switching modes/zoom cancels active gestures. Save errors keep the editor open.
- Meal detail: local changes load household items once and use `searchAll` with the
  catalogue and aliases. Results show categories; typed quantities are preserved,
  new items get a guessed category, and failures are shown instead of clearing the input.
  `addMealItem` now returns an insert failure to the UI.
- Verification: TypeScript and production build passed; browser checks against a temporary 390px-wide,
  24×28 map fixture passed zoom, pan, fit/reset, cell selection, placement and keyboard
  removal. The fixture was removed. New UI text passed Nynorsk dictionary checking.
  No real map was saved and logged-in meal changes still need a phone check.
- These UI changes are local, pending explicit approval to push/deploy.
- Remaining: Kassalapp lookup outside Volda, baseline schema dump, phase 4 connector,
  and phase 5. Do not treat the original migration/access blockers below as current.

From a Claude Code session to whoever picks this up next (Codex). Read this first, then
[docs/REMAKE-PLAN.md](docs/REMAKE-PLAN.md) for the full plan and per-phase status.

## What this is

A Nynorsk shopping-list PWA for Vebjørn and his wife (one household, more later).
Next.js 14 (App Router, server actions) + TypeScript + Tailwind, Supabase (Postgres +
Realtime broadcast), deployed on Vercel at https://handleliste-nine.vercel.app.
Repo `vskeide/handleliste` is **public**. Every push to `main` deploys to production.

## State right now

- `main` = `060addb`, pushed and live. Working tree clean (this file is the only new commit).
- Phases 0–3 of the plan are built and live: security lock-down, speed, catalogue/meals,
  shops/routes. Phase 4 (AI connector) and phase 5 (personal logins etc.) not started.
- Nothing is verified **logged in**: the agent had no PIN. Vebjørn tests on his phone.

## Open items, in priority order

1. **Run SQL 0004 and 0005 in Supabase** (SQL Editor, paste the file, Run). Verified
   *not run* at handover; 0002 and 0003 are run.
   - `supabase/migrations/0004_household_adults_children.sql` → adults/children in
     Innstillingar. Until run, setHouseholdSize saves only the total and says so.
   - `supabase/migrations/0005_routes_per_shop.sql` → per-shop route learning. Until
     run, `learnRoute` skips quietly and sorting falls back to the shop's section layout.
   - No agent can run SQL yet: no Supabase connector, no DB password in `.env.local`,
     the built-in browser wasn't signed in. Options: Vebjørn runs them, or he adds the
     Supabase MCP connector, or puts a `SUPABASE_DB_URL` connection string in
     `.env.local` (then also do the missing baseline dump, item 5).
   - The SQL Editor shows a "destructive operations" warning for `drop policy`/`revoke`
     (0002); the newer files have none. Nothing in them deletes data.

2. **Shop map zoom on phones** (his latest request: "almost impossible to edit layout on
   phone, make it possible to zoom into the map"). Not started.
   File: `app/(app)/butikkar/[id]/kart/grid-map-client.tsx` (≈600 lines). The grid is
   24×28 cells for his one saved map (REMA 1000 Øvre Rotset), drawn as a
   `relative … overflow-hidden touch-none` div with `aspectRatio` and %-positioned tiles.
   Suggested approach:
   - Wrap the grid in an `overflow-auto` scroll container; give the grid
     `width: ${zoom * 100}%` (zoom 1–4) with − / + buttons (and a "fit" button).
     All pointer maths already uses `getBoundingClientRect()` (`cellAt`,
     `onTilePointerDown`, `handlePointerMove`), so it keeps working when zoomed.
   - `touch-none` currently blocks native panning/pinch. In **view** mode allow
     `touch-action: pan-x pan-y pinch-zoom`; in **edit** mode keep `none` on the grid
     but pan by scrolling the container with two fingers, or add a "pan / edit" toggle.
   - Make the tap targets usable when zoomed: the red × (h-5 w-5) and the resize edge
     zone (`MIN_EDGE_PX = 10`) are small at zoom 1.
   - The section palette hides names on phones (`hidden sm:inline`); consider showing them.

3. **Meal page search** (`app/(app)/middagar/[id]/page.tsx`) still uses the old server
   search `searchItems` per keystroke and a manual section picker. Port it to the local
   `searchAll` (lib/match.ts) + catalogue like the list screen.

4. **Kassalapp shop lookup** for shops outside Volda (all 9 Volda shops already have
   coordinates in `stores`). Key works: `KASSALAPP_API_KEY` is in `.env.local` and in
   Vercel. `GET /api/v1/physical-stores?lat=&lng=&km=` returns shops with coordinates;
   it has duplicates (e.g. "Mega Volda" twice). Hobby tier = non-commercial only.
   Smoke test: `node scripts/kassal-test.mjs`.

5. **Baseline schema dump** (`supabase/migrations/0001_baseline.sql`) is still missing;
   the original tables exist only in Supabase. Needs DB access (`pg_dump` or the
   connector).

6. Phase 4 (MCP connector for Claude/ChatGPT: `add_items`, `get_list`, `add_meal`, own
   revocable token, never the PIN) and phase 5: see the plan.

## How the code fits together

| Area | Where |
|---|---|
| Session (HMAC-signed cookie, `readSession`/`requireSession`) | `lib/session.ts` |
| Ownership checks for every row id from the browser | `lib/ownership.ts` |
| List screen (search, add bar, outbox, GPS, sorting, modes) | `app/(app)/lister/[id]/list-detail-client.tsx` (big) + `page.tsx` (loads everything in parallel) |
| Live sync: server-action reads + content-free Realtime broadcast ping | `lib/hooks/use-realtime-list.ts` |
| Offline queue (localStorage outbox) | `lib/hooks/use-outbox.ts` |
| GPS shop detection (`classify` is pure and tested) | `lib/hooks/use-nearby-store.ts` |
| Keyboard-aware add bar | `lib/hooks/use-keyboard-viewport.ts` |
| Catalogue (475 products, Nynorsk, Bokmål aliases) / starter dinners (53) | `lib/catalog-data.ts`, `lib/starter-meals.ts` |
| Search + name matching (own items + catalogue) | `lib/match.ts` |
| Typed/pasted text → lines ("2 kg potet, 3 egg og rømme") | `lib/parse-list.ts` |
| Quantities: parse, add (g↔kg, ml↔dl↔L), scale | `lib/quantity.ts` |
| Merge lines into a list without duplicates | `lib/list-merge.ts` |
| Portions = adults + ½ × children | `lib/portions.ts` |
| Server actions | `lib/actions/{lists,items,meals,templates,stores,auth}.ts` |
| Keep-alive cron (daily 06:00 UTC, `CRON_SECRET`) | `app/api/keepalive/route.ts`, `vercel.json` |
| PWA: icons drawn with next/og, small service worker | `app/icons/[file]/route.tsx`, `public/sw.js` |

Sorting in the shop (list screen): item route in this shop → section route in this
shop (shared across households) → the shop's hand-made section layout → old global
tick order. Positions are 0..1 through the trip, moving average over ~8 trips.

## Rules that bit or matter

- **Public repo.** Never commit `.env.local` (gitignored) or any key. Secrets live in
  `.env.local` locally and in Vercel env vars (all marked Sensitive).
- **Browser has no table access.** RLS is on for every table with no policies; all data
  goes through server actions using the service-role key. Any new table needs RLS on and
  `revoke all … from anon, authenticated` (see 0002/0005). Every server action that takes
  an id must check ownership (`lib/ownership.ts`).
- **Schema changes = a new numbered file in `supabase/migrations/`**, written to be safe
  to re-run, and code that tolerates the change not being run yet (`select('*')`, quiet
  fallbacks). Tell Vebjørn to run it; verify afterwards with a service-role query.
- **UI language is Nynorsk.** Proofread new UI text before shipping:
  `py -3 "$AI_HOME/skills/nynorsk-korrektur/scripts/korrektur.py" sjekk <file>`.
  Docs/commits in English.
- **Push = production deploy.** He has approved each push explicitly; keep asking.
  Check the deploy with `gh api repos/vskeide/handleliste/commits/<sha>/status --jq .state`.
- The AI-home nightly sync (`claude-sync-push`, 23:00) auto-commits and pushes anything
  uncommitted in this repo, so don't leave half-done work uncommitted overnight.
- Explanations to Vebjørn: short, plain language (see `$AI_HOME/context/me.md`).

## Verify / run

```bash
npx tsc --noEmit          # types
npx next build            # full build (Windows: next/og routes must stay runtime='edge')
node scripts/kassal-test.mjs
```
Local preview: `npm run start` after a build (port 3000); logged-in pages need his PIN,
so test those on his phone. Data checks: small `node --env-file=.env.local -e` scripts
with `@supabase/supabase-js` and the service-role key (read-only unless asked).

## Data facts (2026-11-05)

One household "Krumsvik Skeide" (`VOLDA-7599`; he merged the old duplicates himself),
2 adults + children not yet set (0004 pending), ~250 items, 17 lists, 3 own meals,
9 Volda shops with coordinates, one saved shop map (REMA 1000 Øvre Rotset, 24×28).
Backup of the map before it was doubled: in the previous session's scratchpad
(`store_map_backup_2026-11-05.json`), not in the repo.
