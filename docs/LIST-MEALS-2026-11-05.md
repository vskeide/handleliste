# Dinners attached to a shopping list

Implemented locally; production push awaits approval. This follows the local clear-list
commit `57228e0`.

The utensils button in the existing list header opens a native dialog containing the
dinners added to this list. The overview is closed by default and uses no list space
when closed. Each dinner shows its added ingredients and portions. Remove an entire
dinner with confirmation, or remove one ingredient with its row action. Saved recipes
are unchanged.

## Storage and writes

- Migration `20261105204338_list_meal_sources.sql` is applied through the connector.
  New private tables store dinner snapshots and their actual contributions to list
  quantities. Indexes cover foreign keys; RLS is enabled and only service_role has
  table/function permissions. Household checks remain in the RPCs.
- Dinner batch additions and removals run inside the existing transactional,
  household-serialized, receipt-safe `apply_list_operation`. Main-list saved/starter
  dinners, meal-detail additions and connector save/add paths record source amounts.
- Shared ingredient removal subtracts only the selected source. Manual shopping
  quantities remain. An incompatible merge contributes no amount to remove.
- A manually overridden quantity is preserved when removing dinners; the overview
  explains this on the ingredient. Whole-line deletion detaches its source links.
  Reusing an already picked line starts a new visit without inheriting old sources.
- Dinner names/amounts are snapshots, so later recipe changes cannot change an old
  shopping list. The overview covers future additions; old ingredients cannot be
  reliably assigned to dinners retroactively. Copy-previous/template actions continue
  to copy products only, without inventing dinner provenance.
- `get_list_contents` reads lines and dinner snapshots together. Polling/broadcast
  refreshes, successful write results and offline caches include the dinner state.
  The local queue projects pending source changes; a source already present in the
  server snapshot is never added twice after a lost response.
- Clear-list also removes the dinner snapshots present when confirmed.

## Verification

- Unit coverage includes shared and manual quantities, single-ingredient removal,
  manual overrides, remove/re-add, checked-line reuse, offline operations, incompatible
  units and a refresh seeing a committed-but-unacknowledged dinner.
- Rollback-only SQL checks in `tests/list-meals.sql` passed via the connector, including
  replay, shared contributions, recipe preservation, whole-line deletion IDs,
  concurrent removal, ownership, connector addition and unit conversion. Existing
  list-write and relative-route SQL suites also passed; no fixture rows remain.
- Browser fixture verified the overview is initially hidden, opens with the two meal
  snapshots, and removes one ingredient while preserving the other dinner. A native
  confirmation blocked further browser automation; whole-dinner persistence is
  verified by the SQL suite, not claimed as an authenticated browser end-to-end test.
  The temporary fixture page was removed.
- Supabase security advisor reports only the expected informational no-policy notices
  for server-only tables. No browser table permissions were added.

Unrelated shop/map changes in the shared working tree belong to the other chat.
