# 0004 — Thread list anchoring: anchor on the tapped note, never auto-pin

Status: accepted
Date: 2026-06-21

## Context

Opening a thread on a reply must land on that reply and keep it visually fixed
while the rest of the thread fills in. The data arrives in two passes
(`features/feed/hooks/useThread.ts`):

- **T0 (seed):** a cached slice renders the target (focused) note immediately —
  stable key `t_${event.id}`.
- **T1 (full fetch):** `buildThreadItemsFromResult` rebuilds `items` as
  `[...parents, target, ...replies]`, **prepending the entire parent/ancestor
  chain above the target in one update**. Replies then append below on
  pagination.

The reader's requirement: the focused note must not move when (a) the parent
chain mounts above it or (b) replies load below it, and the thread must never
auto-scroll to the bottom like a chat.

The thread `LegendList` (`@legendapp/list@3.0.0`) was rendered **without**
`maintainVisibleContentPosition`. In v3 the prop normalizes via
`normalizeMaintainVisibleContentPosition`:

```
true            → { data: true,  size: true  }
{ … }           → { data: ?? false, size: ?? true }
false           → { data: false, size: false }
(omitted)       → { data: false, size: true }   // ← what the thread got
```

The prepend offset-compensation path is gated on `.data`
(`if (dataChanged && doMVCP && state.props.maintainVisibleContentPosition.data && …)`).
With `data:false` it never runs, so the T1 parent prepend was not compensated and
the focused note dropped by the measured height of the parent chain.

A prior attempt (PR #225) layered manual `scrollToIndex` re-pins on top
(one-shot, then sustained via `onItemSizeChanged`). It still shifted: those
manual corrections race the library's own anchoring — the "don't fight the
library's correction" failure mode.

## Decision

Anchor the thread declaratively, reusing the same mechanism the DM `ChatScreen`
already relies on:

1. **`maintainVisibleContentPosition` (bare → `{ data: true, size: true }`)** on
   the thread `LegendList`. `data:true` compensates the parent prepend; `size:true`
   absorbs estimate→measured reconciliation.
2. **`anchoredEndSpace={{ anchorIndex: targetIndex }}`** reserves tail space so the
   focused note can reach the top of the viewport. mVCP compensates a prepend by
   *raising the scroll offset*, but that is clamped at the max scroll offset — a
   thread with little content below the target can't scroll far enough, so the note
   drops anyway. The reserve sizes to `viewport − (content from anchorIndex down) −
   footer − paddingBottom`, shrinking to 0 once the replies below already fill the
   screen (no dead gap on long threads), and waits for measured sizes (no estimate
   thrash). It is read by the v3.0.0 RN runtime but omitted from the exported RN
   prop type, so it is typed locally and passed via spread.
3. **`initialScrollIndex={targetIndex}`** lands the first paint on the tapped note.
4. **No bottom-dock / auto-pin props.** Unlike `ChatScreen`, the thread omits
   `initialScrollAtEnd`, `alignItemsAtEnd`, and `maintainScrollAtEnd` — it anchors
   on the note, not the tail, and must never auto-scroll down.

## Consequences

- The focused note holds across the T0→T1 parent prepend with no manual scroll
  math; replies appending below do not move it.
- Behaviour is verified at the source level against the installed v3.0.0, and the
  proof is on-device (native `ScrollView` mVCP cannot be exercised in jest).
- `data:true` routes the data path through native `ScrollView` mVCP (Android needs
  RN ≥ 0.72; satisfied by our Expo SDK). The known racy edge (LegendApp/legend-list
  #463) bites *near the bottom* of a list; our anchor is the top-pinned note with a
  single prepend — the well-behaved case.

## Alternatives rejected

- **Manual `scrollToIndex` re-pin (PR #225).** Races the library's anchoring;
  still shifted in practice.
- **`inverted`.** A transform hack; legend-list refuses it and the native mVCP
  primitive explicitly ignores transforms.
- **Sharing the DM bottom-dock preset.** Would auto-pin to bottom — the opposite
  of the thread's anchor-on-note requirement.
