# Status indicators — the rules

Every "loading → resolved" UI in the app renders through `LoadingIndicator` from `shared/blocks/status`. One component, three phases (`idle` / `loading` / `done`), three results (`success` / `error` / `reverted`). It replaced the old `PaymentStatusIcon`, `AnimatedCheckpointDot`, and the bespoke recovery shield — there is exactly one canonical animated status surface.

## When to reach for `LoadingIndicator`

- A spinner that resolves into a checkmark, cross, or counter-clockwise revert arrow (payment toasts, mint validation, recovery flow, transaction timeline checkpoints).
- A static "decoration" check for a non-interactive completion screen — pass `playOnMount` so the draw-in animation plays on entry instead of the terminal-state short-circuit kicking in.
- A bare loading spinner — pass `phase="loading"` and don't worry about the result. Visually equivalent to a small spinner, keeps the codebase using one component.

## When NOT to reach for it

- ❌ **Selection checkmarks** ("is this option selected?") — use `SelectableCheck` from `shared/ui/primitives/SelectableCheck`. Different semantic register entirely.
- ❌ **Static decorative checks at sizes < 18px in tight layouts** where you want the check to fill the box (e.g. a 16px bullet). The disc is ~76% of size, the glyph ~28% — at very small sizes a static `<Icon name="fluent:checkmark-16-filled" />` reads more boldly. The split-bill `ParticipantStatusIcon` for the "scheduled" fallback is an example of the legitimate exception.
- ❌ **Pure progress** (download bars, upload percentages). `LoadingIndicator` is a binary loading-vs-resolved indicator, not a progress meter.

## The mapping for status-like domain types

The shared `CheckpointStatus` vocabulary in `shared/blocks/status/mapCheckpointStatus.ts` is what the timeline and transfer-step chain consume. Its strict type is `'future' | 'future-small' | 'next-pending' | 'current' | 'complete' | 'success' | 'failed' | 'rolled-back' | 'already-spent'`. The helper `mapCheckpointStatusToIndicator(status)` returns `{ phase, result }` ready to spread into a `<LoadingIndicator>`.

If your domain status is one of those literals (timeline/chain integrations), call the helper directly. If it's a different domain vocabulary (`'pending' | 'paid' | 'expired'` for split-bill participants, `'confirmed' | 'failed'` for payments, etc.), mirror the same pattern inline:

- "in flight" → `phase: 'loading'`
- "succeeded" → `phase: 'done', result: 'success'`
- "failed / expired" → `phase: 'done', result: 'error'`
- "reverted / rolled back / already spent" → `phase: 'done', result: 'reverted'`

`ParticipantStatusIcon` in `features/splitBill/components/` is the canonical example of this inline-mapping pattern.

## Props that solve specific problems

- **`color`** — defaults to theme `foreground` (the ring/idle stroke). Override only when rendering on a fixed-contrast surface (e.g. a toast over a dark-tinted background where you need explicit white).
- **`successColor` / `errorColor` / `revertedColor`** — default from theme `success` / `danger` / `warning`. Override only when matching a non-theme palette (e.g. the recovery hero, which deliberately uses `green-400` / `red-400`).
- **`transitionDelayMs`** — for cascading multiple indicators in a row (timeline steps fanning open left-to-right). Don't use for entrance animations — wrap in `Animated.View entering={…}` instead.
- **`playOnMount`** — overrides the default terminal-state short-circuit so a fresh mount in `phase='done'` plays the draw-in animation. Use for static decorations. Don't use for re-rendering an already-resolved row (e.g. the recovery per-mint rows depend on the short-circuit).

## Don't reinvent

- ❌ Don't author a new `react-native-svg` spinner with stroke-dasharray. Use `LoadingIndicator phase='loading'` even if there's no terminal state — visual consistency wins.
- ❌ Don't reach for `<ActivityIndicator>` from `react-native`. Same rule: `LoadingIndicator phase='loading'`.
- ❌ Don't import the legacy `PaymentStatusIcon`, `AnimatedCheckpointDot`, or `animatedStatusShapes.ts`. They were deleted; the references will fail to resolve.
- ❌ Don't override the geometry constants (`RING_R`, `ICON.*`). They were tuned to match the legacy `PaymentStatusIcon`'s 75% disc-to-box ratio — changing them desynchronizes every status surface in the app.
