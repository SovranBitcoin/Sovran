# Lens: content shift (native CLS)

Scope: every surface with async content — feed, thread, profile, composer,
transactions, mint list, wallet balance. The product owner treats any
post-first-paint movement of already-settled content as a **defect**. This
repo has first-class instrumentation: `app/shared/lib/contentShiftLog.ts`
(`*.shift.*` taxonomy) and log-doctor `visual` mode. Load `sovran-ui` — it
carries the skeleton/content-shift rules; don't contradict it.

## Dimension reservation

- Every image in a post body / list row needs width+height or `aspectRatio`
  known **before** load (API metadata or cached measurement) — never sized
  from `onLoad`. Detect: `<Image` styles without fixed dims whose parent isn't
  fixed-size; `onLoad`-driven `setState` that changes layout.
- Text/badge/counter slots that appear after async resolution (fiat value,
  zap counts, follow state) need reserved space or absolute positioning.
  Detect: conditional rendering `{x && <Badge/>}` inline in a row's flex flow.
- Fonts: async font swap after first paint reflows text — verify splash gates
  on `useFonts`.

## Insertion & anchoring

- Never insert above existing content without an anchor: prepends (new posts,
  pending tx rows) must be behind a "N new posts" tap, below the viewport, or
  covered by `maintainVisibleContentPosition`. Detect: `unshift`/prepend into
  list data on surfaces where MVCP is disabled or the keys are unstable.
- Reordering under MVCP causes jank — rank-reshuffles of a visible feed are a
  shift bug even with MVCP on.
- Chat-style stick-to-bottom belongs to `autoscrollToTopThreshold`, not manual
  scroll math.

## Skeleton parity

- Skeletons must share layout constants/chrome with the real component
  (`onLayout`-measured, not hard-coded `minHeight` — repo rule). Detect:
  independently hard-coded skeleton heights; skeleton row counts diverging
  from typical content.
- Skeleton/spinner for sub-300ms loads reads as flicker — cached-data surfaces
  should render cache instantly, no placeholder pass.
- Shimmer should be a slow wave, not a pulse, and respect reduced motion.

## Settling chrome

- Headers, large-title collapse, async banners, keyboard-driven reflow: space
  pre-reserved or rendered in an absolute layer. Known repo classes: iOS
  modal header 83→70 settle (`contentInsetAdjustmentBehavior` fix), Android
  sheet-header scrim inset. Look for *new* instances of the same shapes.
- Animated `height` on containers with siblings below is a shift generator —
  cross-report with the animations lens only once.

## Evidence

Runtime beats static here — prefer instrumented findings:

```bash
npx tsx codereview/log-doctor/index.ts visual   --latest
npx tsx codereview/log-doctor/index.ts visual   --latest --scope 'thread\.'
npx tsx codereview/log-doctor/index.ts timeline --event 'visual\.layout|\.shift\.' --latest
rg -n "useShiftLogger|contentShiftLog" features shared      # where coverage exists
rg -n "onLoad=|onLayout=" features | rg -i "set|height"
rg -n "minHeight" features shared                            # hard-coded skeleton sizing
```

Surfaces *without* `useShiftLogger` coverage are themselves a finding class:
"instrument X so shifts become visible" — but cap at one such finding per run.

## Do not flag

- Intentional layout changes driven by explicit user action (expanding a
  post, toggling a section).
- Shifts already fixed on unmerged branches (check ledger + recent branch
  names before reporting header/modal settle classes).
