# 3. Thread list anchors on the tapped note, never auto-pins

Date: 2026-06-21
Status: Accepted

## Context

Opening a thread on a reply paints in stages: a **seed** (own-note or
`threadSeedCache`) renders the tapped note instantly as a single row, or
skeletons render first; then the full `getThread` result replaces it with
`[...parents, target, ...replies]`. That **prepends the parent chain above the
already-visible target**, and a row's height snaps from `estimatedItemSize` to
its measured height a frame later. Both move the focused note under the reader's
thumb — violating the core "content must never reshuffle under the thumb"
principle.

`initialScrollIndex={targetIndex}` only fires at mount, so it can't hold the
target once parents arrive. The previous defense was an **opacity-0-until-
target-settled reveal** that hid only the sort-tabs row during the snap — it
masked one symptom, not the parent-prepend shift.

## Decision

Anchor the thread `LegendList` on the **tapped note**:

- Add **`maintainVisibleContentPosition`**. It holds the first visible row (the
  target) in place, so the parent chain fills in **off-screen above** and a
  height snap above the anchor doesn't move it. This is the same mechanism the DM
  screen already relies on for prepended older messages.
- Keep landing on the target via `initialScrollIndex`. "Start at the bottom" =
  scrolled past the parent chain to the focused note (target at the top of the
  viewport, replies reading downward below it).
- **No `maintainScrollAtEnd`.** A thread is not a chat: replies appended below
  (initial fill or `loadMoreReplies`) must not yank the view down. The reader's
  position is preserved.
- **Remove the opacity-reveal hack** (`revealOpacity`/`handleTargetSettled` and
  the sort-tabs opacity wrapper) — `maintainVisibleContentPosition` subsumes it,
  and we don't keep two anti-shift mechanisms.

## Consequences

- Parents stream in above and replies load below without the focused note ever
  shifting; new content never auto-scrolls the reader.
- One position-stability owner (the list prop) instead of a bespoke
  reveal-masking dance. `getFixedItemSize`/`estimatedItemSize` stay — they feed
  the list's offset math and virtualization, not just shift-masking.
- The change is a prop on a native list, so it is verified on-device against the
  existing `thread.shift.*` / `visualList` taxonomy, not in unit tests.

## Alternatives considered

- **`inverted`** — legend-list doesn't support it and it breaks entering/exiting
  animations; rejected.
- **`alignItemsAtEnd` + `initialScrollAtEnd`** (the DM bottom-pin set) — those
  anchor the *newest reply* at the absolute bottom; we want the *tapped note*.
- **A shared "anchored list" preset with the DM screen** — rejected as a forced
  abstraction: DM wants bottom-pin + auto-follow, thread wants anchor-on-target +
  no auto-pin. The only shared prop is `maintainVisibleContentPosition`.
- **Keep the opacity-reveal hack as belt-and-suspenders** — rejected (no-shim
  policy; two mechanisms for one job).
