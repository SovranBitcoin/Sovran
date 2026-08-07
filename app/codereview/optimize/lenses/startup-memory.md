# Lens: startup & memory

Scope: entry chain (`index.js` → root `_layout` → providers), persisted
stores, module-scope state, timers/listeners. Load `sovran-data` for the
persisted-store rules before judging anything persistence-related.

## Startup cost

- **Eager imports of heavy deps**: Skia scenes, QR/camera, crypto libs,
  charts, maps top-level-imported in files reachable from the root layout
  evaluate before first frame. Detect: trace imports of
  `@shopify/react-native-skia`, `expo-camera`, `expo-maps`,
  `react-native-quick-crypto`, marmot/whitenoise, bitchat from the entry
  chain; the fix shape is lazy `require`/`React.lazy` behind the owning
  screen.
- **Barrel exports** (`export * from` in index files imported at startup) make
  everything reachable and defeat tree-shaking; also a known circular-dep/HMR
  hazard. Detect: `rg "export \* from" --glob 'index.ts*'` then check
  startup reachability.
- **Persisted-store hydration**: large blobs (feed cache, tx annotations,
  media ledgers) hydrate synchronously via AsyncStorage JSON at startup.
  Detect: persisted stores whose state contains growing arrays without
  `partialize`/size caps. (Repo precedent: one oversized annotation key wiped
  all tx annotations.)
- **Splash gating**: `SplashScreen.hideAsync` should await fonts + store
  hydration + first frame — but never network. Detect: network awaits in the
  splash gate; conversely, hide-immediately with fonts still loading (shift
  lens overlap).
- Analytics/logging/SDK init at module top level of the entry chain — defer
  past TTI.
- `log-doctor startup --latest` gives the real waterfall — use it to rank;
  static suspicion alone is P2 at best here.

## Memory & leaks

- Listeners without cleanup: `addListener`/`on(`/`subscribe` in effects
  lacking a `return () => …remove()` — AppState, Keyboard, emitters, relay
  subs (the nostr lens owns relay specifics; report the *pattern* here only
  for non-nostr cases).
- Timers: `setInterval`/`setTimeout` polling (mint status, feed refresh)
  without clear-on-unmount, or intervals that keep running while the app is
  backgrounded/screen blurred.
- Module-scope Maps/arrays/caches with `.set`/`.push` and no eviction —
  memoization caches keyed by event/tx id grow for the session lifetime.
  Detect: module-level collections in hot data paths without TTL/size cap.
- `gc --latest` log-doctor mode for runtime confirmation of growth.

## New Architecture notes

- `collapsable={false}` applied broadly disables view flattening — flag
  wide use; deep utility-wrapper `View` nests (uniwind) add native views.
- `setTimeout(0)`-style legacy bridge timing hacks are suspect under Fabric's
  event batching.

## Evidence

```bash
npx tsx codereview/log-doctor/index.ts startup --latest
npx tsx codereview/log-doctor/index.ts gc --latest
rg -n "export \* from" app features shared --glob 'index.ts*'
rg -n "setInterval|setTimeout" features shared -A 1
rg -n "addListener|\.on\(" features shared | rg -v "remove|off\("
rg -n "new Map\(|new Set\(" shared features --glob '!*.test.*'   # module scope only
rg -n "partialize" features shared        # inverse: persisted stores without it
```

## Do not flag

- Persisted-schema field changes themselves — that's `sovran-data`'s breaking
  -change territory, not a perf finding (but *size* of persisted state is
  yours).
- Intentional module-scope singletons with bounded state (theme, i18n).
