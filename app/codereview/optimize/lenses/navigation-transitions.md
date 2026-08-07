# Lens: navigation & transitions (expo-router, screens)

Scope: `app/app/**` (routes/layouts), screen components, anywhere
`router.push/back`, `useFocusEffect`, or screen options appear. Stack is
expo-router 56 on react-native-screens 4.25 (native stack).

## Param & layout hooks

- `useGlobalSearchParams` re-renders on **every URL change app-wide**;
  `useLocalSearchParams` only when focused. Detect: any
  `useGlobalSearchParams` in a screen component — almost always wrong.
- `_layout.tsx` bodies re-render on every route change — heavy hooks, store
  subscriptions, or context value rebuilds there fan out to the whole tree.
  Detect: non-trivial logic in layout files.
- Inline `options={{ header: () => … }}` / per-render `screenOptions` objects
  re-render headers each pass. Detect: fresh objects/closures in options at
  screen-component level.
- Dynamic `key` props on `Stack.Screen`/layouts force remounts — the classic
  cause of "effects refire on back-nav". Detect statically, and cross-check
  any fetch-on-mount finding from the render-perf lens.

## Transition-time JS work

- The top jank source: fetches, store hydration, decryption, list mounts fired
  synchronously in mount effects of a just-pushed screen — they compete with
  the push animation. Detect: expensive work in `useEffect`/`useFocusEffect`
  on mount without deferral (`InteractionManager.runAfterInteractions`,
  transition-end listener, `useDeferredValue`, or deferred heavy children).
  Runtime confirmation: `js_thread_blocked` events / `slow` gaps aligned with
  screen-change entries.
- `useLayoutEffect` + `measure()` is synchronous pre-paint on New Architecture
  — heavy work there blocks the frame. Detect: nontrivial `useLayoutEffect`
  bodies.

## Freeze & remount behavior

- For a feed app, blurred screens should generally be frozen — but this repo
  has history: FlashList corruption under `freezeOnBlur` (fixed by 2.3.2 bump,
  device verify pending). Review *interactions* of freeze options with lists;
  don't just flag presence/absence.
- Screens re-entered via back-nav re-running `[]`-dep effects = remount
  misconfiguration, not a data bug. Verify before blaming the data layer.

## Evidence

```bash
rg -n "useGlobalSearchParams" app features
rg -n "InteractionManager|runAfterInteractions|transitionEnd" app features shared
rg -n "useLayoutEffect" features shared
rg -n "freezeOnBlur|detachInactiveScreens|unstable_settings" app
npx tsx codereview/log-doctor/index.ts slow --latest --threshold 200
npx tsx codereview/log-doctor/index.ts screens --latest   # big; use only when tracing a specific flow
npx tsx codereview/log-doctor/index.ts stats --latest     # js_thread_blocked frequency
```

## Do not flag

- `historyView='1'` route-param pattern — deliberate (route-group provider
  fails); see `reference` docs/memory before touching.
- Root-entry reset behavior in payment flows — owned by the payments state
  machine contract, judge under the state-machines lens.
