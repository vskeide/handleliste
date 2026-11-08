# Handover: Handleliste remake (2026-11-05)

## Codex follow-up (2026-11-05)

This checkpoint supersedes the original status below:

- **Compact-header follow-up (2026-11-08), local:** one page title row with shared
  hamburger on the right, inline "Middagar" panel under the list header, neutral GPS
  icon without "heime?", circular store-add button, and search-input/keyboard styling
  fixes. See the follow-up section of `docs/MOBILE-UI-2026-11-08.md`. The user approved
  pushing/publishing these refinements as version 0.2.1. The domain strip reported on
  Edge Android remains a physical-phone verification limitation.

- **Mobile UI update (2026-11-08), local:** top full-screen hamburger navigation,
  typed-only list suggestions, household meals only in list search, isolated picker
  scrolling, clearer collapsed dinner rows, and an explicit screen-awake switch.
  The list's header +/map buttons and old bottom-navigation spacing are removed.
  See `docs/MOBILE-UI-2026-11-08.md` for scope and the remaining Android Edge
  keyboard/autofill verification. The user approved this push on 2026-11-08 and
  requested a webpage version update: 0.2.0, including the service-worker cache
  generation. Verify the final deployment SHA before treating it as live.

- **Release approval (2026-11-05):** The user explicitly approved committing,
  pushing and deploying all changes, including the side chats. The release includes
  clear-list, the hidden dinner overview with source-aware ingredient removal,
  simplified mobile map editing, and household store creation. Migration
  `20261105204338_list_meal_sources.sql` is applied and the list/route/meal SQL
  regression suites pass with rolled-back fixtures. All 62 current tests and
  TypeScript pass. Production deployment status must be checked against the final
  pushed SHA; this approval does not imply unverified future work is live.
  Details and verification boundaries: `docs/LIST-MEALS-2026-11-05.md`.

- **Assistant connector implemented in the side chat:** `/mcp`, OAuth discovery,
  PKCE consent/sign-in, DCR plus ChatGPT/Claude published identities (including signed
  client assertions), expiring/rotating hashed tokens and revocation in
  Innstillingar → ChatGPT og Claude. Six tools read lists/meals, add items to a selected
  list, save a recipe, and add a saved meal to a selected list. No model API calls.
  Migration **0007 is applied**; new tables/functions are server-role-only. Recipe
  source/instructions appear in Middagar. See `docs/ASSISTANT-CONNECTOR.md` for setup,
  design and precise verification boundaries. 38 unit tests and 10 actual HTTP flow
  groups pass; test fixtures were removed. Production push and real account linking
  are pending; the connector is not claimed live or tested inside the two AI apps yet.
- Corrected the Tailwind plugin import for Node 24 dev-server compatibility (ESM
  import rather than `require` inside the TS config).

- **Latest implementation:** Next.js **15.5.29**, React **19.3.1**, matching lint/types,
  and supported icons. Cookies/route params now use async APIs; existing HMAC cookies
  remain compatible. Removed unused Supabase Auth middleware/SSR wrapper and Zod.
  PostCSS is pinned/overridden to 8.5.32; a clean `npm ci` reproduces it. Production
  `npm audit --omit=dev` is clean; six moderate ESLint/minimatch development-tool
  entries remain (no critical/high findings).
- Picked items start collapsed in both list modes and expand with an accessible button.
- All main-list add/create/tick/quantity/remove/reset/bulk/meal/copy writes now go
  through one persisted serial queue (`lib/list-outbox.ts`, hook wrapper). Stable
  operation IDs, remapped server IDs, pending-change overlays and cached row/product
  metadata survive refresh/reload. Rejections remain visible with Retry/Discard.
- **0006 is applied in Supabase**: unique list/product index, server-only receipt table,
  service-role-only transactional `apply_list_operation`, and quantity merge helper.
  It checks household ownership, serializes household writes, resolves product aliases,
  merges batch quantities atomically, and counts ticks/routes only on real transitions.
  One queued operation needs one DB RPC. Receipts are retained for reliable retries;
  do not prune them without also defining an expiry rule for queued operations.
- Verification: **24 unit/regression tests**, production build, TypeScript, clean install
  and Nynorsk check pass. `tests/list-writes.sql` ran through the connector and passed
  replay/ownership/canonical-product/atomic rollback checks; its fixtures were rolled
  back (zero left). New table/functions block browser roles; security advisor has only
  expected RLS-without-policy informational notices. Browser fixture checked collapse/
  expand, refused-write feedback, and pending quantity after reload. Real two-phone
  airplane-mode/upgrade smoke check is still needed before calling phone UX verified.
- Scope: main-list writes use the new RPC. Older meal-detail → list and template/layout
  actions still need the transactional follow-ups described in the audit. Logout cache
  isolation, settings races, PIN/session hardening and quantity rounding remain open.
- App changes remain local, pending push approval. DB additions are backward-compatible
  with the current live app; the uniqueness index now protects it against duplicates.

- **Read `docs/AUDIT-2026-11-05.md` before more features.** Audit found a supported
  Next.js upgrade and retry-safe offline/atomic writes are the main priorities. Do not
  treat Next 14.2.35 as currently patched: upstream fixes are on newer supported branches.
  Local audit fixes restrict privileged update fields, report merge/map write errors,
  preserve the displayed list on failed refresh, fix decimal-comma parsing, share the
  quantity parser, parallelize map-page reads, and permit browser zoom. 13 regression
  tests (`npm test`), TypeScript and production build pass. Full findings, remaining
  issues and the short KISS feature list are in the audit. No live DB/schema changes
  were made during the audit; changes are pending push approval.
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
- Captured `supabase/migrations/0001_baseline.sql` through the connector: schema-only,
  consolidated through 0005, with all 16 app tables, 54 constraints, 31 indexes, the
  trigger function, 3 triggers and server-only permissions. Compared every captured
  definition with a second live catalog query (100/100 matched). This is a catalog
  snapshot, not a full pg_dump: Supabase-managed schemas/settings and seed rows are
  excluded, and a fresh-database restore has not been tested. Do not apply it to live
  production as a new migration. `scripts/export-schema.sql` is the read-only capture query.
- Rechecked all 16 live tables: RLS on, no browser CRUD privileges, server access intact.
- Remaining: Kassalapp lookup outside Volda, phase 4 connector,
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
