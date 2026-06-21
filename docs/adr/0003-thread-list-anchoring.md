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

- Add **`maintainVisibleContentPosition`** (`{data:true, size:true}`). It holds
  the visible anchor when a row resizes or replies append — the same mechanism the
  DM screen relies on for prepended older messages.
- **Pin the target through the parent prepend** with an explicit one-shot
  `scrollToIndex(targetIndex)` when parents first appear. `maintainVisibleContent`
  `Position` alone is insufficient here: a prepended parent first lays out at the
  flat `estimatedItemSize`, the data-anchor corrects against *that estimate*, then
  the parent measures to its real (taller, variable) height and the delta shoves
  the focused note down (an open upstream issue for variable-height prepends). An
  active scroll target is re-resolved on every layout pass, so driving
  `scrollToIndex` pins the note through the measurement settle. It fires once per
  thread and bails if the reader has already dragged the list. The DM screen
  doesn't need this — chat bubbles are short and near-uniform, so the estimate
  error is negligible; a full parent card is not.
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
