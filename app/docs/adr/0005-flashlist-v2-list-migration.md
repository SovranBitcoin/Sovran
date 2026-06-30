# 0005 — Replace @legendapp/list with FlashList v2 across the app

Status: accepted
Date: 2026-06-22

## Context

Every virtualized list in the app was built on `@legendapp/list` (LegendList,
v3.0.6). The thread reader's scroll-stability work ([[0004]]) accreted a large
amount of scaffolding to fight LegendList's **asynchronous measurement**: rows
render at an `estimatedItemSize`, then measure a frame later, so anchored content
shifts. Working around that needed a two-list off-screen crossfade,
`getFixedItemSize` skeleton hints, an `onItemSizeChanged` counter-scroll, a
`{ data: true, size: false }` mVCP split, and reveal gating — "very hacky," in
the reporter's words, with residual artifacts.

A spike (`spike/flashlist-v2-thread`, behind a Settings toggle) proved that
`@shopify/flash-list@2` holds the focused note with **no** scaffolding beyond a
bottom `focusReserve`: FlashList v2 is New-Arch-only and lays out synchronously
under Fabric, with `maintainVisibleContentPosition` on by default, so the
estimate→measure shift class disappears at the source.

## Decision

1. **Remove `@legendapp/list` entirely; FlashList v2 everywhere.** No
   compatibility shim, no dual-path toggle — the spike's `flashListThread`
   Settings flag and the whole LegendList thread path are deleted.

2. **One shared seam for the common case.** `shared/ui/composed/List.tsx`
   (`<List>`) owns the only app import of `@shopify/flash-list` and applies the
   app defaults (hidden scroll indicator, `drawDistance`). Plain data lists
   render through `<List>`; the four specialized surfaces that need full control
   of the underlying list import FlashList directly:
   - **ThreadView** — anchor on the tapped note (`focusReserve` + index-0 seed +
     `initialScrollIndex` + default mVCP); the legend two-list / counter-scroll /
     reveal scaffolding is retired.
   - **ChatScreen / AiChatScreen** — chat-bottom via
     `maintainVisibleContentPosition={{ startRenderingFromBottom: true,
     autoscrollToBottomThreshold: 0.1 }}` (replaces LegendList's
     `initialScrollAtEnd` / `alignItemsAtEnd` / `maintainScrollAtEnd`).
   - **SectionAnchorList** — `getItemType` recycling, `scrollToIndex({viewOffset})`,
     and gorhom `BottomSheetScrollView` injection via `renderScrollComponent`.
   - **Transactions** — section list; per-row collapse keeps its reanimated
     `layout` transition (Transaction.tsx). LegendList's `itemLayoutAnimation`
     (which animated *sibling* reflow) has no FlashList v2 equivalent, so sibling
     reflow is now immediate.

3. **Drop the content-shift *list* telemetry.** FlashList lacks
   `onItemSizeChanged` / `onMetricsChange` / `onStickyHeaderChange` / `getState()`,
   and FlashList's synchronous layout makes the diagnostics they fed obsolete.
   All list-level instrumentation (the `useVisualListLogger` wiring, the five
   callbacks, `getListState`, and the per-row `VisualLayoutProbe` wrappers inside
   list `renderItem`s) is removed. The shared content-shift logging library
   (`contentShiftLog.ts`) stays — its element-level hooks remain in use by the
   composer, primitives, and the notification screens.

## Consequences

- `estimatedItemSize`, `recycleItems`, `getFixedItemSize`, `itemsAreEqual` and
  the legend-only `getState()` scroll-state read are gone; FlashList measures
  synchronously and recycles by default.
- `threadListLayout.ts` collapses to a single `NOTE_CONTENT_LINE_HEIGHT` export
  (the skeleton fixed-size helpers were legend-only). `threadFixedItemSize.test`
  and `visualLayoutCoverage.test` (which enforced the now-removed list telemetry
  contract) are deleted.
- Transaction sibling-reflow on a row collapse is no longer animated. Accepted
  as a minor degradation; revisit with a `CellRendererComponent` layout-animation
  shim only if it reads poorly on device.
- Gates green: `tsc` clean, `eslint` clean on the changed files, all
  migration-touching tests pass. (Two pre-existing `naggFeedClient*` suite
  failures and the `facadeFeedAdapter` prettier errors are unrelated to this
  change — they fail identically on the branch without it.)
- Device verification pending — the matrix to walk: thread anchor, feed
  pull-to-refresh + pagination, profile feed, chat bottom-stick + keyboard,
  emoji/mention sheet scroll, transaction collapse, contacts refresh +
  pagination.
