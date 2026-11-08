# Portions and ingredient quantities on a shopping list

Implemented in `79a205c`; the user approved pushing/deploying on 2026-11-08.
Release 0.2.2 updates both the visible version and service-worker cache generation.
Verify the final release SHA is READY in Vercel before treating it as live.

Under Middagar, expand a listed dinner and use its portion button. Saving rescales
only that dinner's linked ingredients. Ingredient amounts use the same quantity/unit
picker as ordinary shopping-list lines. These edits update list snapshots and totals;
the saved recipe and its servings/ingredients are never written.

- Shared product totals replace only the selected dinner's share. Other dinners and
  manually added amounts remain. Compatible weight/volume units convert normally;
  incompatible mixed units are rejected before any partial edit is committed.
- Each ingredient lazily records its portion basis, preventing cumulative rounding
  drift when portions change back and forth. A direct edit within the dinner resets
  that ingredient's basis at the current portion count. Small fractional kg/L amounts
  retain extra precision. Removed ingredients are not re-added by scaling.
- A missing original portion count must be supplied explicitly; it is not guessed.
  Whole-list quantity overrides have deliberately detached source shares and remain
  protected. Such rows direct the user to edit them in the main list. Text quantities
  without a numeric amount are not automatically scaled.
- New `mealServings` and `mealQty` queue operations use the existing durable serial
  outbox, canonical item aliases and transactional receipt IDs. Their optimistic
  projection uses absolute desired values and stable bases, so a refresh seeing a
  committed-but-unacknowledged operation does not apply its delta twice.
- Migration `20261108214408_edit_list_meal_quantities.sql` is applied via the
  Supabase connector. It adds nullable basis fields and service-role-only invoker
  helpers, updates the list snapshot, and dispatches the two new kinds through the
  existing ownership-checked, household-serialized RPC. Existing clients remain
  compatible; no existing household list data was rewritten by the migration.

Verification: all 74 tests, TypeScript and Nynorsk UI checks pass. Unit tests cover
shared sources, fixed bases, ingredient edits,
unknown portions, overrides, removed lines, unit conflicts and retry projections.
`tests/list-meal-edit.sql` passed with rolled-back fixtures, including recipe
preservation, replay, household isolation and atomic multi-ingredient failures.
Existing list-write, list-meal and route SQL suites also passed. Browser fixture at
390 CSS pixels verified 4→6 portions (400→600 g), editing to 700 g, then 6→3 portions
(350 g), while the other dinner remained at 500 g and the manual 100 g remained.
This was a UI/projection fixture plus separate database integration checks, not an
authenticated browser-to-database test. The temporary fixture was removed.
