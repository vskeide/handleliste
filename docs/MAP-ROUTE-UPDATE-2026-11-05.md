# Relative routes and mobile map editing

Implemented locally, awaiting the user's next production-push approval.

## Route learning

- Migration 0008 is applied through the Supabase connector. It preserves historical
  averages and the existing receipt-safe RPC signature. New clients read relative
  comparisons instead of absolute fractions of a shopping list.
- A checked item compares with up to 12 nearby observed picks on the same list and
  shop, within 90 minutes. Unticked items and earlier visits do not acquire assumed
  positions. Capture timestamps preserve order when offline devices sync in reverse.
- Item comparisons stay within the household. Shared section comparisons contain
  section IDs only. First arrival at a section avoids repeated votes from a large
  aisle or walking back for a forgotten product. Recent evidence uses a rolling
  memory of eight observations; household weight in shared comparisons is capped.
- Stable graph ordering respects decisive comparisons, resolves cycles predictably,
  and uses manual section/name order as fallback. The current screen remains stable
  while shopping; reopening, reloading or changing shops loads the latest ranks.
- Existing legacy queued writes without capture timestamps remain compatible.

## Map controls

- Two-finger pinch/pan in view and edit modes; adding a second finger cancels and
  restores an in-progress geometry edit. One-finger pan in view or Flytt kartet mode.
- Tap a section to select it; hold 350 ms to move it on touch. The explicit Flytt
  action also arms movement. Desktop mouse dragging remains immediate.
- Four full-edge resize targets, 44 px thick, with collision/boundary checks.
- Delete selected section with a large button, drop a moving section into the bin,
  or use the desktop right-click menu. Angre sletting restores the last deleted
  section if its original space is free. Changes persist only with Lagre kart.
- Keyboard arrows move sections/resize focused edges; Delete removes a section.

## Verification and limits

- Route/map unit tests cover partial trips, transitive comparisons, ambiguity/cycles,
  shared evidence, all resize edges, bounds/collisions and pinch/pan geometry.
- `tests/relative-route.sql` and `tests/list-writes.sql` passed through the connector;
  fixtures roll back. The former covers replay, unpicked products, section balance,
  carry-over, offline capture order and non-shopping ticks.
- Browser fixture verified four-edge resizing, right-click deletion, undo and zoom.
  The fixture was removed. Real-phone two-finger/long-press/drop-bin testing remains
  necessary; browser automation does not establish physical touch ergonomics.
- The connector changes in the shared working tree belong to the side chat.
