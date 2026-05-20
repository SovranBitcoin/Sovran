# Thread skeletons & content-shift containment — the rules

When a thread view loads, replies arrive asynchronously and their rendered heights are content-dependent. Naively swapping skeletons for real PostCards causes visible jank: rows resize, the scroll position drifts, and the eye snags on the "pop." Sovran's thread-loading flow is designed around three compromises that minimise these shifts and a designed-on-purpose **exit shimmer that masks whatever shifts still slip through**.

If you're touching `ThreadView`, `PostCardSkeleton`, the reply skeleton variants, or the exit shimmer, read this first — the decisions look fussy in isolation but each one earns its keep against a specific measurement.

## The architecture in 30 seconds

1. **Loading phase** — `ThreadView` renders `reply-skeleton` items. Each shows static placeholder bars (`Text loading`, `Avatar state="loading"`, `MetricsFooterSkeleton`) plus a continuous **`SkeletonLoadingShimmer`** overlay (background-tinted, ambient).
2. **Measuring phase** — once `useThread` returns replies and skeleton heights are captured via `onLayout`, a hidden absolutely-positioned tree renders up to `REPLY_MEASUREMENT_CANDIDATE_LIMIT` (12) real `PostCard`s in `measurementMode` to measure their actual heights.
3. **Sort** — `sortRepliesByMeasuredHeights` greedily assigns each of the 5 visible skeleton slots the candidate whose measured height is closest. Slot 0 picks first (most visible, so most expensive to mis-match), then 1, etc.
4. **Exit transition** — when the sort commits, `transitionPhase` flips to `'exiting'`. List items become `transition-reply`: the real `PostCard` renders in flow (`FadeIn`) with the skeleton overlaid (`SkeletonExitReveal`: opacity 1→0 + a single bright shimmer pass). After `SKELETON_EXIT_DURATION_MS` (620ms) it flips to `'done'` and items become plain `reply`.

The exit transition waits for the in-flight loading shimmer to finish — `msUntilLoadingShimmerPassEnds` returns the ms remaining in the current cycle so the bright exit shimmer never interrupts the quiet loading shimmer mid-sweep.

## The compromises (and why)

### 1. Skeleton variants vary in shape, but bias toward 1-line

`REPLY_SKELETON_VARIANTS` in `features/feed/lib/threadReplySkeletons.ts` is `[1, 1, 2, 1, 1]` lines. Most nostr replies are short ("Congrats", "GM", "Welcome!") — biasing the skeleton pool toward 1-line means the height-match sort can usually find a real reply that fits each slot. Multi-line variants exist for visual variety so the loading state doesn't look like 5 identical stripes, but the distribution is intentionally skewed toward what the data actually looks like.

### 2. Measure 12 candidates for 5 slots

The hidden measurement tree renders 12 PostCards, not 5. The sort needs candidates to choose from — if it only had 5 it'd have no choice when none of them fit a particular slot. 12 gives the algorithm enough freedom that for typical threads every slot finds a perfect (or near-perfect) height match.

12 is also as far as we go for performance reasons (see "Performance" below).

### 3. Soft-sort, not best-sort

The sort is **greedy slot-by-slot**, not globally optimal. Slot 0 picks the best match from the pool, then slot 1 picks from what's left, etc. Globally-optimal assignment is `O(n²)` and gains very little — the top slot is the most visible, so prioritising it first is the right heuristic.

Replies that don't make the first 5 slots stay in their original chronological order after the matched batch — we don't try to height-sort the entire thread.

### 4. Seeded threads bypass the measurement transition

When `useThread` returns replies immediately from `consumeThreadSeed` (cached navigation), `repliesSeenWhileFetchingRef` becomes true and the measurement phase is skipped. Replies render directly without the skeleton→transition→reply dance. The seed already paid for accurate ordering elsewhere; re-sorting them by measured height would *cause* a shift, not prevent one.

### 5. Skeletons use very low contrast against the background

Both `Text loading` (`opacity(foreground, 0.07)`) and `Avatar state="loading"` (same) keep skeleton fills well below the dominant background. `MetricsFooterSkeleton` matches by overriding `bg-skeleton` with the same alpha. Low contrast means the skeletons read as "something will appear here" rather than as content blocks — and crucially, **any residual shift when real content arrives is visually smaller** because the eye doesn't need to track the disappearance of a high-contrast shape.

## The exit shimmer's job

Even with measurement-driven sort, some shifts remain — content has emoji, nostr mentions resolve to varied-width names, link previews load asynchronously. The exit shimmer is the safety net: a single bright shimmer sweep (`SkeletonExitReveal`, foreground@0.55) combined with opacity 1→0 on the skeleton overlay creates enough visual change that residual height drift reads as part of "the transition happening" rather than as a glitch.

The exit shimmer is intentionally brighter and faster than the loading shimmer:

- **Loading shimmer** — background-tinted (`opacity(background, 0.85)`), wide (110% of row), slow (2200ms pass + 350ms gap, repeats). Quiet, ambient, "still loading."
- **Exit shimmer** — foreground-tinted (`opacity(foreground, 0.55)`), narrow (90px), one-shot (620ms with `Easing.out(Easing.cubic)`). Bright, punchy, "here's your content."

The visual hierarchy is deliberate: the eye registers the bright exit shimmer as the meaningful event, which gives the underlying height-and-content swap cover.

## When you're touching this code

### When you're adding a new skeleton-to-real-content transition

Reach for the same primitives:

- `SkeletonLoadingShimmer` (from `features/feed/components/nostr/SkeletonExitShimmer.tsx`) for the loading-phase ambient shimmer
- `SkeletonExitReveal` for the exit transition (wraps the skeleton, takes an `active` boolean)
- Pair them: skeleton with both active during loading, then flip `exiting=true` to trigger the reveal

### When you're adding a new placeholder shape

Add to `REPLY_SKELETON_VARIANTS` (or write your own variant array) following the same distribution principle: **bias toward what the real data usually looks like, not what looks evenly varied.** A loading state where every slot fits the typical case is better than one that's "balanced" but mismatches reality.

### When the measurement pool size needs tuning

`REPLY_MEASUREMENT_CANDIDATE_LIMIT` is 12. Each candidate renders a full PostCard offscreen — profile lookups, NoteContent segment parsing, etc. Raising it gives the sort more options but costs JS-thread time at load (the hidden tree is the main contributor to `perf.js_thread_blocked` events on thread open). Lowering it below ~8 starts producing visible mismatches because typical threads don't have enough variety in their first 8 replies for the sort to find good fits for all 5 slots.

If you're tuning, watch:

```bash
npx tsx codereview/log-doctor/index.ts full --event measured_sort --latest --format json
```

The `matches[].heightDelta` should cluster near 0 for the top 5 slots. Anything > 50px residual is a sort failure — widen the pool or revisit the variant shapes.

### When the exit shimmer's timing changes

If you change `SKELETON_EXIT_DURATION_MS`, also update `TRANSITION_REPLY_FADE_IN` in `ThreadView.tsx` — they're intentionally the same duration so the skeleton fade-out and the content fade-in fully overlap. They drift if you only change one.

The exit waits for the loading shimmer pass via `msUntilLoadingShimmerPassEnds(shimmerStartedAtRef.current)`. If you change either of the loading shimmer timings (`SKELETON_LOADING_SHIMMER_DURATION_MS`, `SKELETON_LOADING_SHIMMER_GAP_MS`), the helper picks up the new cycle automatically — no other coordination needed.

## Performance — what the hidden measurement tree costs

Rendering 12 real PostCards offscreen is the heaviest single operation in the thread-load flow. Mitigations already in place:

- `measurementMode` prop on `PostCard` skips `Avatar` image prefetch (avoids 12 simultaneous network requests). Avatar layout is fixed by `AVATAR_SIZE` regardless of state, so height accuracy is preserved.
- `setMeasuredVersion` only fires once (on the first skeleton's `onLayout`), not per skeleton — subsequent measurements only update the ref. The sort reads from the ref at trigger time, so accuracy is preserved and we save ~4 re-renders.
- Memoised gradient color arrays, style arrays, and animation configs (`TRANSITION_REPLY_FADE_IN` at module scope) to keep Reanimated's per-frame work cheap.

If you need to add a heavier per-card render path (a new segment type in `NoteContent`, for example), profile thread-load before-and-after:

```bash
npx tsx codereview/log-doctor/index.ts full --event js_thread_blocked --latest
```

Any new block > 200ms during the measurement window is regression-worthy.

## Don't

- ❌ **Skip the exit shimmer.** A pure opacity cross-fade reveals every residual content shift. The shimmer's job is to be the dominant visual event during the swap so the eye watches it instead of the content drift.
- ❌ **Predict line counts in code.** We had a line-count-based estimator (`estimateReplyLineCount`); it was systematically wrong on small screens, with emoji, and with mentions. The hidden measurement tree exists because measurement is the only reliable answer. Keep it.
- ❌ **Sort the entire reply list by height.** Only the top 5 slots are height-matched. Everything else stays in its arrival order — re-sorting visible content below the fold to satisfy a height heuristic would itself cause shifts.
- ❌ **Show high-contrast skeletons.** `opacity(foreground, 0.15)` was the previous default. It drew the eye too strongly and made the eventual content swap feel violent. `0.07` lets the placeholders fade into the background.
- ❌ **Run the exit shimmer concurrently with the loading shimmer.** `msUntilLoadingShimmerPassEnds` exists for this — the loading sweep must finish (or be in its idle gap) before the exit kicks off, or the two shimmers cross-fade into visual mush.
