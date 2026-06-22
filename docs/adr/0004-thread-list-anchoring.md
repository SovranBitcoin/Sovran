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

1. **`maintainVisibleContentPosition={{ data: true, size: false }}`** on the thread
   `LegendList`. `data:true` lets the library compensate the parent prepend;
   `size:false` hands the size axis entirely to our counter-scroll (3) so the two
   never both move the scroll — that double-correction is what oscillated into jitter.
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

3. **Own the size axis** (`onItemSizeChanged`), split on whether the real list is
   shown yet (`revealedRef`). The note can be moved by above-note rows changing size:
   the prepend's **estimate→measured** jump (parents range ~145–523px; v3 has no
   per-item estimate) and **late media** (an image with no `imeta` dims reshapes 16:9
   → real on `onLoad`; videos are locked, so they don't reshape).
   - **Before the swap (off-screen):** do **not** counter-scroll per row. Summing many
     deltas in a burst undershoots — with 3 parents (711px total) it landed at scroll
     575, ~136px short, and arrived as one visible `jumpY:−530` at the swap. Instead we
     just wait for the parents to go quiet, then (4) lands the note authoritatively.
   - **After the swap:** a slow parent image can still reshape; the parent is off-screen
     above the note, so we counter-scroll by its exact delta to absorb it. One change at
     a time here → no burst, no undershoot.

   We're the **sole** owner of this axis (mVCP runs `size:false`), so it can't race the
   library the way PR #225's sustained `scrollToIndex` re-pin did. A `readerMovedRef`
   (set on `onScrollBeginDrag`) hands control back to the user, after which mVCP `data`
   still anchors future prepends.

4. **`initialScrollIndex={targetIndex}`** lands the first paint on the tapped note.
5. **No bottom-dock / auto-pin props.** Unlike `ChatScreen`, the thread omits
   `initialScrollAtEnd`, `alignItemsAtEnd`, and `maintainScrollAtEnd` — it anchors
   on the note, not the tail, and must never auto-scroll down.
6. **Resolve off-screen, land authoritatively, then swap directly.** Even with
   (1)–(3), the prepend + re-anchor plays out over several frames and _reads as jitter_
   on screen. So we render **two lists**: a **seed list** (tapped note + replies,
   parents filtered out) that the reader sees immediately, and the **real list** (full
   thread) that resolves **off-screen** (`opacity: 0`, `pointerEvents: none`). Once the
   above-note rows stop changing size (`scheduleReveal` debounce + fallback), we do one
   **`scrollToIndex(noteIndex, { viewPosition: 0 })`** to put the note at the top —
   exact for any parent count, by which point the parents are measured — and reveal on
   the next frame (so the scroll has applied while still hidden). The **swap is
   instant** (`revealed` flips, seed unmounts); no fade, because the resolved view is a
   pixel match for the seed. This replaces both the older per-row opacity "reveal hack"
   and the fragile delta-summing landing.

7. **Withhold real reply content until revealed.** Both lists pre-reveal show reply
   **skeletons** only — `seedData` and the hidden `realData` filter out real `reply`
   rows. If the hidden real list rendered real replies, they'd load (text + images) and
   reach a half-loaded state off-screen, then be shown un-settled at the swap, their
   `REPLY_FADE_IN` skeleton→real crossfade already spent while invisible (the "replies
   show before they've settled" bug). Gating means reply rows mount only once the list
   is visible, so the fade plays as designed. Parents are unaffected — they still need
   to settle off-screen for the landing (6), and they're above the note, not below.

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
- **Known residual (out of scope): replies settling _below_ the note.** The anchor
  holds the note perfectly (verified: pageY constant across a 49-reply load), but the
  replies under it still reflow as they resolve — reply skeletons (fixed height) don't
  match variable real-reply heights, and reply images without `imeta` dims reshape on
  load (16:9 → real). The two-list swap can't hide this: the seed list renders the
  same replies, so reply reflow is visible on whichever list is shown (unlike the
  parents, which exist only on the real list). This is the same variable-height /
  media-reservation problem the feed has; the durable fix is feed-wide (skeleton
  height matching + reply-image dimension reservation via `imeta` / the aspect cache),
  not thread-anchor work.

## Alternatives rejected

- **Manual `scrollToIndex` re-pin (PR #225).** Races the library's anchoring;
  still shifted in practice.
- **`inverted`.** A transform hack; legend-list refuses it and the native mVCP
  primitive explicitly ignores transforms.
- **Sharing the DM bottom-dock preset.** Would auto-pin to bottom — the opposite
  of the thread's anchor-on-note requirement.
