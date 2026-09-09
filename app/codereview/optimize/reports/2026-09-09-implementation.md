# Performance implementation and research — 2026-09-09

Baseline: `2ba87c865e8d3a2125be87f2425d007d7d1211a5` in `sovran-app`. The tree was clean before this work. No persisted store objects, durable schemas, wallet balances, keys or database contents were changed by the investigation. No live payment was executed.

The subsequent [interaction and correctness pass](2026-09-09-second-pass.md) adds fixes for the reported crashes, ecash latency/cancellation, navigation, QR geometry, receive currency selection and same-total proof freshness. Its combined verification supersedes the first-pass gate totals below.

## Scope and evidence

The request covers Expo/React Native on Android and iOS, dependency internals, rendering, data loading, navigation, lists, media, wallet read models, swap/rebalance correctness and service availability. This pass combines installed-source inspection, official upstream research, deterministic regressions, repository quality gates and production Hermes exports. It does **not** establish device frame rates, startup latency, GPU cost, battery use, optical QR reliability or live payment correctness.

[Dependency and feature inventory](2026-09-09-dependencies.md) maps all 92 direct runtime dependencies. The list census found 31 JSX list instances: 20 uses of the shared List, six direct FlashList instances including the shared implementation, three FlatList instances and two animated lists. Mapping a surface is distinct from deeply reviewing it; remaining work is explicit below.

## Implemented changes

Work counts and timer durations below come from controlled regression fixtures, not production telemetry or device benchmarks.

| Area | Reproduced problem | Result and evidence |
| --- | --- | --- |
| Wallet balances | Each event started another snapshot; obtaining the total also scanned ready proofs again inside Coco. | A 20-event burst falls from 21 snapshot batches to two, and the reproduced ready-proof reads from 42 to two. The total is derived using Coco Amount from the same per-mint snapshot. Manager/unit changes and stale completions are guarded. |
| Wallet proof suggestions | An old sat proof read could overwrite the current USD suggestions, and scope changes exposed old denominations on the first commit. | Snapshot scope includes manager, unit, trusted mint set and balance signature. Late reads are discarded; nine provider regressions cover scope changes, filtering, sorting and unchanged-input read counts. |
| Transaction history | Event bursts overlapped history reads, and an event arriving during pagination could be dropped. | Coalesced active/trailing reads, parallel independent initial supplements, and refresh preservation during pagination. Burst reproducer: 21 batches to two. |
| Receive rail | Linking a known visible receive operation walked up to 15 history pages even when the target was on the first page. Quote IDs could collide across mints. | Targeted mint+quote matching stops when all requested links are found: 15 reads to one in the first-page fixture; the bounded missing-target search remains. |
| Nostr thread entry | The navigation seed existed but was applied after the first render. | Cached/thread-navigation content populates initial state synchronously, then follows existing revalidation. Pure peek before commit; consume after commit. Target changes cannot inherit the previous thread. |
| Skeleton transition | Sequential skeleton/content fades had a blank midpoint and content could remount at completion. A renewed loading prop could call unloaded content before the effect. | The canonical SkeletonContentCrossfade shows opaque content under one fading skeleton overlay, preserves its content host, and honors loading in the current render. Existing snapshots remain unchanged. Recycled cells still support `exit="none"`; reduced motion stays instant. |
| Recycled feed cells | Expanded text, failed-image state/aspect ratio, poll selection and pending submissions could belong to a previous item/viewer. | Item-bound recycling state and submission identity. Regression tests cover item changes and old async completion. |
| Swap mint metadata | Sequential metadata resolution delayed details, and old results could belong to an earlier mint selection. | Read the existing mint metadata owner on first render; revalidate misses with at most three workers and discard superseded groups. |
| Contact/profile metadata | A batch hook could remain loading after its cache write invalidated its own effect. Unrelated author updates rerendered whole contact batches. | Requested-key snapshot equality and request-key accounting. Twenty unrelated writes produce zero batch rerenders instead of twenty; a relevant change still renders. Store replacement and LRU eviction remain observable. |
| Profile detail refresh | Manual refetch outlived profile navigation; the first commit could expose the previous person's fetched statistics. | Request cancellation and scope-bound snapshots, including manual refetch and stale completion tests. |
| Image prefetch | A native `false` result was remembered as success, duplicates did not await shared completion, and large batches launched without a global bound. | One in-flight promise per URL, four simultaneous native prefetches, bounded remembered successes, retry after false/rejection. Existing startup gate and HTTP(S) restrictions retained. |
| Animated QR | Old UR frames could appear after a payload/density change, and hidden/background routes continued matrix updates. | Payload-bound encoding state; frame timers owned by route focus, AppState and Android window focus. Real bc-ur encode/decode roundtrips cover all density presets and UTF-8. Resume reuses encoding. |
| Wallpaper motion | Shared motion continued after its final subscriber; reduced-motion users still subscribed to sensor effects. | Cancel the final shared spring and gate motion subscribers on reduced motion. Existing native sensor background suspension was verified rather than duplicated. |
| Wallpaper downloads | Concurrent writers shared staging paths; HTTP/download/promotion errors could overwrite the previous file, particularly with iOS non-overwriting moves. | Per-attempt staging, validated download, serialized per-target publication and rollback backup. Late writers only clean their own files; active stages/backups survive orphan cleanup. Eight mocked filesystem regressions. |
| Stories video | Player replacement set a shared mounted flag false forever, preventing advancement after the second story. Twenty native currentTime reads/sec duplicated event payload data; closing did not stop updates promptly. | Mount and player lifetimes separated; use timeUpdate payloads, pause inactive/closing updates and discard late press/close callbacks. |
| NDK startup | SQLite adapter construction happened in render before stage/key readiness, twice under StrictMode replay. | Effect-owned cache construction after the existing readiness gates: zero while blocked, one under replay. Preserve the existing 800 ms cache warmup before NDK initialization. |
| Connectivity | Reachability/version checks used a Nagg endpoint returning 404; polling continued while backgrounded. | Use the configured API base for the version endpoint. Suspend background polling and discard obsolete checks; check promptly on resume while retaining foreground hysteresis. |
| Nostr cooldown | A concurrent successful read reset the failure count but left an armed 30-second cooldown active. | Success closes the existing breaker. Tests retain consecutive-failure, isolated-timeout, HTTP-error and caller-abort semantics; no new fallback tier or duplicate breaker. |
| Abort resources | A timeout's one-shot abort listener removed only itself; longer-lived caller signals retained listeners for expired requests. Notification pages rebuilt the same combined session signal. | Release every input listener when the combined signal aborts, handle already-aborted inputs without retained listeners, and reuse the notification session signal. Same fix in wallet's independent transport boundary. Timeout budgets unchanged. |
| Mempool transaction status | A pending 90-second request launched four reads; background routes continued polling and a new txid briefly displayed old status. | Focus/AppState-owned completion scheduling reduces this to one pending read, preserves same-tx cached status and stops at required confirmation depth. Adapter reads cannot be aborted, so late results are ignored and follow-up work is suppressed. |
| Rebalance settlement | Recipient credit could precede the initial balance baseline, causing an unnecessary 15-second wait. Unrelated balance increases could satisfy verification, and Coco v2 refresh objects were compared to old strings. | Verify the exact prepared mint operation and clean finalized outcome; consume current Coco melt operation states. Twenty-two actual-hook regressions cover identities, delayed credit, errors, units, cancellation, middleman flow and intermediate/final-hop retry identity. Including run-state and audit tests, the focused rebalance gate has 36 tests. |
| Rebalance audit reads | Independent auditor reads were serial. | At most three workers, deterministic candidate ordering, existing best-effort result handling. |

The rebalance receipt check is read-only and keeps the existing verification budgets and best-effort completion policy. An unrelated deposit no longer satisfies the receipt check, but the pre-existing policy can still mark a successful source melt done after recipient verification times out. Intermediate-hop timeout continuation, sat-specific fee/melt assumptions and incomplete cancellation around preparation/global recovery are not corrected here. Manager replacement tests cover rerendered hooks; they do not establish full profile isolation for detached background closures after unmount. These are explicit remaining payment-safety work, not performance claims.

Independent review caught a new middleman retry identity omission: a replacement invoice initially retained the previous hop's receipt operation. Both intermediate and final retry cases now track and annotate the replacement operation, leave the abandoned receipt pending, and finish after the existing 500 ms pause with no extra melt execution.

The transaction detail entry path already synchronously seeds its route session through `createScreenActionSession`/`useSyncExternalStore`. This work does not claim that the receive-history scan was the cause of every historical blank transaction screen.

## Loading and preloading convention

Use the existing data owner first: the Nostr entity cache, thread/navigation seed, mint metadata cache or transaction route session. Bind displayed local snapshots to the same identity as the destination (including manager/profile/unit where relevant). Revalidate after rendering usable data; never treat a navigation hint as authoritative payment settlement. A pure read belongs in first-render initialization; consuming a navigation handoff belongs after commit.

Use the shared SkeletonContentCrossfade only when required content is actually absent, sharing geometry/chrome between loading and loaded variants. Do not substitute a skeleton for already cached data, restart it for background refresh, or add a separate screen-specific fade system. Recycled list cells use the existing instant-exit option. Noncritical work remains behind existing startup/focus gates. Image prefetch remains centralized in imageCache.

No general-purpose second query cache or new persisted preload store was introduced.

## Installed stack and upstream findings

| Stack | Source-backed conclusion |
| --- | --- |
| Expo 56.0.20, React Native 0.85.3, React 19.2.3 | App code already uses Expo's React Compiler path and Metro inline requires. Do not add memoization everywhere, duplicate the worklets Babel plugin or assume node_modules is compiler-optimized. [Expo compiler guide](https://docs.expo.dev/guides/react-compiler/) |
| Hermes compiler 250829098.0.10 | The installed version falls within the reported Hermes v1 memory regression affecting Worklets/Reanimated. The published remediation requires a coordinated native SDK/RN upgrade and testing; it is not an OTA JavaScript fix. No blind dependency upgrade was made. [Expo SDK 56 notice](https://expo.dev/changelog/sdk-56), [upstream issue](https://github.com/expo/expo/issues/46519) |
| Reanimated 4.5.1, Worklets 0.10.1 | UI worklets avoid per-frame JS crossings; reading a shared value from JS can block on the UI thread. Reduced-motion behavior was checked against the installed hook. No broad static feature-flag changes without native measurement. [Shared values](https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/), [reduced motion](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion/) |
| FlashList 2.3.2 | Recycling preserves component identity, so item-local state must explicitly reset when the item changes. Main mixed feed/search/thread/notification lists already provide item types. No global drawDistance/window change was justified by device evidence. [Recycling](https://shopify.github.io/flash-list/docs/recycling/) |
| Zustand 5.0.15 | Snapshot identity determines consumer work. Narrow selectors and stable requested-key snapshots are preferable to replacing the persisted model. Cache eviction semantics require retaining the global notification where keyed eviction notifications are unavailable. [useShallow guidance](https://zustand.docs.pmnd.rs/learn/guides/prevent-rerenders-with-use-shallow.html) |
| Zod 4.4.3 | Preserve validation at trust/persistence boundaries. Newer Zod compilation APIs are not in this installed version; no unsafe parse bypass or persisted enum tightening was used as an optimization. [Basics](https://zod.dev/basics), [Zod 4](https://zod.dev/v4) |
| Coco 2.0.0, cashu-ts 5.0.0-rc.4 | Installed balance APIs and Amount arithmetic were read directly. Coco's operation objects, quote ownership and recovery errors govern settlement; arbitrary total balance changes do not prove receipt. [Coco WalletBalancesApi](https://github.com/cashubtc/coco/blob/7dada8305be1c0a1e6b1ecaa9d53a91c5686771c/packages/core/api/WalletBalancesApi.ts), [ProofService](https://github.com/cashubtc/coco/blob/7dada8305be1c0a1e6b1ecaa9d53a91c5686771c/packages/core/services/ProofService.ts), [cashu-ts Amount](https://github.com/cashubtc/cashu-ts/blob/35cf7a63fdef28b960c148aa4d6db0c708968673/src/model/Amount.ts) |
| NDK-mobile 0.2.2 / SQLite | The installed cache constructor immediately initializes/openDatabaseSync; queries use readiness checks and may miss before migrations finish. Construction moved behind startup gates while preserving its warmup. Existing Metro exclusion of unused NDK-wallet and singleton crypto resolution were retained. |
| expo-image 56.0.12 | Prefetch resolves a boolean; false must remain retryable. Bounded fan-out changes transport pressure, not cache authority. [Image API](https://docs.expo.dev/versions/latest/sdk/image/) |
| expo-file-system 56.0.10 | Legacy DownloadResumable/move/delete implementation inspected for platform differences. Native file replacement needs device validation even with failure-injection tests. [SDK 56 legacy filesystem](https://docs.expo.dev/versions/v56.0.0/sdk/filesystem-legacy/) |
| expo-network 56.0.5 | Installed Android implementation checks network capabilities; the prior blanket comment calling it socket presence was outdated. iOS still needs the explicit reachability behavior. [SDK 56 network](https://docs.expo.dev/versions/v56.0.0/sdk/network/) |
| expo-sensors / Skia 2.6.2 | Native sensors already own background lifecycle. Wallpaper GPU compositing, blur and Skia layers remain device-profiling questions; fewer subscribers is established, FPS improvement is not. [SDK 56 sensors](https://docs.expo.dev/versions/v56.0.0/sdk/sensors/) |
| expo-video 56.1.4 | Installed useVideoPlayer recreates/releases players with source changes; timeUpdate contains currentTime. Tests reproduce source replacement and event lifecycle rather than treating the player as permanent. |
| bc-ur 1.1.12 / react-native-qrcode-svg 6.3.21 | Real UR codec used in tests, while native rendering/scanning remains separate. QR updates still require matrix work on active routes; no precomputation of every SVG frame or token cache was added. [UR encoder](https://github.com/gandlafbtc/bc-ur/blob/main/src/urEncoder.ts), [QR renderer](https://github.com/Expensify/react-native-qrcode-svg/blob/main/src/index.js) |
| RN AbortController | Installed RN 0.85.3 setUpXHR still loads abort-controller. New AbortSignal.any/timeout APIs cannot be assumed on every shipped runtime; the portable composition path remains. [React Native AbortSignal](https://reactnative.dev/docs/global-AbortSignal) |

The only manifest addition is pinned dev-only `cborg@4.5.8`, already present transitively, to make the real UR codec's Jest ESM resolution explicit and pass dependency analysis. There were no runtime dependency upgrades.

## Public service observations

Read-only probes on 2026-09-09; results describe that observation window, not an SLA. No authorization headers, private account identifiers, keys, mint/melt mutations or production database access were used.

| Configured/public endpoint | Probe | Observation |
| --- | --- | --- |
| `https://nagg-mint-production.up.railway.app` | latest-version POST, health GET, feed GET, AI lineup GET | 404 at sampled routes |
| `https://nagg.up.railway.app` (production app-view configuration) | latest-version POST, feed GET, AI lineup GET | 404 at sampled routes |
| `https://api.sovran.money/api/app/latest-version` | POST with version `0.0.0` | 200 with version response; this supports the corrected version/reachability route |
| `https://api.sovran.money/api/cashu/mints` | GET | 200 JSON array |
| `https://mempool.space/api/blocks/tip/height` | GET | 200 numeric height |
| `https://mempool.space/api/v1/fees/recommended` | GET | 200 fee fields |
| `https://api.routstr.com/v1/models` | GET | 404; this is also the documented default, so an alternative provider was not guessed |
| `https://blossom.primal.net/` | GET | 200; upload/signature behavior untested |
| `https://npub.cash/.well-known/nostr.json?name=_` | GET | 200 names/relays; payment behavior untested |
| `wss://ws.sovran.money` / `wss://cache2.primal.net/v1` | Open and close WebSocket | Handshakes succeeded; this does not establish message-level service correctness |

The Nagg and Routstr responses require deployment/provider investigation. An HTTP 404 is not proof of device offline status or grounds for silently choosing a new payment/provider endpoint. [Routstr endpoint documentation](https://docs.routstr.com/api/endpoints/).

## Verification and practical limits

| Gate | Final result | Command |
| --- | --- | --- |
| App Jest | 346 suites, 3,522 tests, 160 snapshots passed | From app: `bun run test --runInBand` |
| Wallet Vitest | 79 files, 1,192 tests passed | From wallet: `bun run test` |
| Nostr Vitest | 30 files, 270 tests passed | From nostr: `bun run test` |
| TypeScript | App iOS and Android, wallet, nostr passed | Root: `bun run type-check` |
| ESLint | Zero errors; 137 existing warnings | Root: `bun run lint` |
| Prettier | Passed | Root: `bun run pretty:check` |
| Dependency analysis | Passed | Root: `bun run knip` |
| Styling guard | 1,104 files, 1,282 sites; none new | From app: `bun run check:styling` |
| React Compiler | 908 functions compiled; 97 bailouts in 33 already-known files; no new bailout files | From app: `bun run check:react-compiler` |
| Patch whitespace | Passed | Root: `git diff --check` |
| Hermes export | iOS and Android passed | From app: command below |

Total automated tests: **4,984 passing**. The final rebalance retry patch additionally passed scoped ESLint/Prettier and both platform typechecks, then the complete app suite and export. The initial structural census found no cycles and reported a heuristic 66/100; that score is not a performance measurement.

```sh
env -u GIVEAWAY_P2PK_SECRET -u DEBUG_MNEMONIC EXPO_NO_DOTENV=1 EAS_BUILD_PROFILE=preview CI=1 bunx expo export --platform ios --platform android --source-maps --max-workers 3 --output-dir /tmp/sovran-optimization-native-export
```

Gate output is retained locally in `/tmp/sovran-optimization-{app-tests-final,wallet-tests-final,nostr-tests,typecheck-final,lint-final,pretty-final,knip-final,styling-final,compiler-final,export-final}.log`.

Baseline app Jest: 327 suites, 3396 tests, 160 snapshots passing. An intermediate complete run caught two layout snapshots affected by an unnecessary skeleton wrapper; the wrapper was removed and the snapshots passed unchanged. Tests cover mocked native lifecycles and deterministic operation outcomes; they cannot establish native rendering or a successful live transfer.

Production iOS and Android Hermes exports completed into `/tmp/sovran-optimization-native-export`. These validate Metro resolution, transforms and bytecode generation, **not** a native application build. Final bytecode sizes are 16,397,384 bytes for iOS and 16,546,608 bytes for Android; source-map source-content sizes must not be presented as shipped package byte sizes or runtime cost. Existing cborg and nested NDK/bc-ur noble-hashes export-resolution warnings remain visible in the export log.

No iOS simulator or Android device was connected/booted during the baseline. Local Xcode is 26.1.1, below SDK 56's documented 26.4 minimum. No native build, runtime screenshots, optical QR scan or funded end-to-end test was claimed.

## Work still required before claiming the app is fully optimized

1. **Native engine/toolchain:** reproduce memory behavior with release builds; coordinate the supported Expo/RN/Hermes upgrade; rerun all native-module, crypto entropy, navigation and payment gates. Hermes is a material unresolved dependency issue.
2. **Profile both platforms:** cold/warm startup, JS/UI frame time, memory after long scrolling, wallpaper combinations, reduced motion, foreground/background transitions, interrupted downloads and QR scans at every density/speed. Include a slower Android device and a high-refresh iPhone. Compare to the baseline on the same devices and data.
3. **Transaction list geometry:** sections, not individual transactions, are the recycled units. A huge same-day section can mount many rows. Flatten only after preserving collapse/ghost rows, section headers, scroll anchors, refresh, history pagination and accessibility in regression/device tests. This was not blindly rewritten.
4. **Service availability:** restore/verify intended Nagg app-view and Routstr deployments and then check real feed/thread/AI responses. The fallback improvements cannot restore a missing backend.
5. **Background consumers:** review remaining price sockets, BLE peer refresh, signer expiry, onchain discovery/acceleration and payment request polling individually. Some deliberately outlive a screen or must continue settlement; a global pause switch would be incorrect. Confirmation detail polling is now focus/foreground-owned, but address/discovery watchers need their own lifecycle contracts.
6. **Remaining feature depth:** AI streaming/markdown, encrypted chats/Marmot, map clustering, BLE/native camera/NFC, keyboard-heavy forms, bottom sheets and native glass need sustained runtime profiling. They are in the dependency/surface inventory and broad tests, not claimed individually optimized.
7. **Payment release confidence:** exercise direct/middleman rebalance, pending/rollback/recovery, profile switching and all supported units against a controlled mint environment, then the native funded test lane. Deterministic tests establish logic contracts, not third-party settlement reliability.
8. **Resolved in the second pass:** wallet proof snapshots now respond to same-total denomination and reservation changes with manager-scoped event coalescing; reserved proofs are excluded. See the second-pass report and actual-provider regressions.
9. **Remaining loading edge:** ContactsScreen's `loadedOnce` initialization can force a spinner on warm entry, while useMintContacts starts with empty enrichment and initially reports not loading. Correct cached mint-contact initialization and readiness together before changing the screen gate. There is no evidence supporting a new skeleton system.

The report intentionally distinguishes implemented/tested improvements from remaining work. It is not an exhaustive performance certification.
