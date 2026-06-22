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
2. **`focusReserve` — explicit bottom padding** so the focused note can reach (and
   be held at) the top of the viewport. mVCP compensates a prepend by _raising the
   scroll offset_, but that is clamped at the max scroll offset — a thread with
   little content below the target can't scroll far enough, so the note drops, the
   scroll bottoms out (snaps), and the note can't be refocused. We add
   `viewport − (rows already below the note × approx row height)` to `paddingBottom`,
   so it's generous on short threads and shrinks toward 0 as replies fill the screen
   (no dead gap on long threads).

   This is owned in `ThreadView` rather than the library's `anchoredEndSpace` on
   purpose: `anchoredEndSpace` is opaque (no public type on the RN entry; not
   reflected in our shift logs) and behaved inconsistently across 3.0.x. The
   explicit reserve is deterministic, hot-reloads with the component (no bundle /
   dependency-version ambiguity), and emits a `thread.reserve` log so a trace can
   confirm it's live and its size.

3. **Own the prepend's size reconciliation** (`onItemSizeChanged`). mVCP scrolls to
   hold the note when the parent prepends, but it anchors against the parent's
   _estimate_ (`estimatedItemSize`) and never reconciles the gap once the parent
   measures to its real height — the note ends up off by exactly `estimate −
measured` (live trace: estimate 200 vs measured 145 → note jumped **up 55px**;
   an earlier media parent measured 523 → **down 323px**). A single global
   `estimatedItemSize` can't fix this (parents range ~145–523px), and v3 exposes no
   per-item estimate. So when a row **above** the note changes size **before the
   reader has scrolled**, we counter-scroll by the delta (`scrollToOffset(scroll +
(size − previous))`). This is the report's "manual offset compensation when you
   control insertion timing" — a one-time reconciliation per parent measure, not a
   sustained re-pin (which is why it doesn't race mVCP the way PR #225 did). A
   `readerMovedRef` (set on `onScrollBeginDrag`) hands control back to the user.
4. **`initialScrollIndex={targetIndex}`** lands the first paint on the tapped note.
5. **No bottom-dock / auto-pin props.** Unlike `ChatScreen`, the thread omits
   `initialScrollAtEnd`, `alignItemsAtEnd`, and `maintainScrollAtEnd` — it anchors
   on the note, not the tail, and must never auto-scroll down.
6. **Resolve off-screen, then swap directly.** Even with (1)–(3), the prepend +
   re-anchor plays out over several frames and _reads as jitter_ on screen. So we
   render **two lists**: a **seed list** (tapped note + replies, parents filtered out)
   that the reader sees immediately, and the **real list** (full thread) that resolves
   **off-screen** (`opacity: 0`, `pointerEvents: none`). The counter-scroll lands the
   note off-screen; once the above-note rows stop changing size (`scheduleReveal`
   debounce + fallback), we **swap instantly** — `revealed` flips, the real list shows,
   the seed unmounts. No fade is needed because the resolved view is a pixel match for
   the seed: same note at the top, same replies below; the parents are simply scrolled
   off above. (A fade would only be masking a residual — and (3) makes the landing
   exact.) This replaces the older per-row opacity "reveal hack" (which only masked the
   rows _below_ the note).

## Consequences

- The focused note holds across the T0→T1 parent prepend with no manual scroll
  math; replies appending below do not move it.
- Behaviour is verified at the source level against the installed v3.0.0, and the
  proof is on-device (native `ScrollView` mVCP cannot be exercised in jest).
- `data:true` routes the data path through native `ScrollView` mVCP (Android needs
  RN ≥ 0.72; satisfied by our Expo SDK). The known racy edge (LegendApp/legend-list
  #463) bites _near the bottom_ of a list; our anchor is the top-pinned note with a
  single prepend — the well-behaved case.
- **Requires `@legendapp/list` ≥ 3.0.4.** The combination was inert/janky on the
  first v3 release (3.0.0): the data-anchoring path was mis-batched (fixed 3.0.3),
  `anchoredEndSpace` reported stale sizes during load (fixed 3.0.4), and
  `scrollToIndex`/`initialScrollIndex` mislanded on iOS (fixed 3.0.1). We pin 3.0.6.
  Re-verify these prop contracts on any future bump — v3 is still beta.

## Alternatives rejected

- **Manual `scrollToIndex` re-pin (PR #225).** Races the library's anchoring;
  still shifted in practice.
- **`inverted`.** A transform hack; legend-list refuses it and the native mVCP
  primitive explicitly ignores transforms.
- **Sharing the DM bottom-dock preset.** Would auto-pin to bottom — the opposite
  of the thread's anchor-on-note requirement.
