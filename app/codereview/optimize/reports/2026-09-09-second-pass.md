# Interaction and correctness optimization: second pass

This pass starts from the user's observed interactions and the actual development log, then reproduces failures at the real component/hook or payment-machine boundary. It supplements [the initial stack inventory](2026-09-09-dependencies.md), [the first implementation report](2026-09-09-implementation.md), and [the ecash investigation](2026-09-09-ecash-interaction.md). No persisted store schema or live funds were changed.

## Evidence and fixes

| Observed problem | Cause verified | Change and regression coverage |
| --- | --- | --- |
| Create ecash appears unresponsive | Amount inspection synchronously enumerated subsets even for divisible Cashu denominations. The log contains 79 sat-composition timings totaling 30.6 seconds, and 24 nested fiat timings totaling 17.1 seconds; these totals must not be added. | Exact divisible-denomination path, including repeated/missing/nonbinary denominations and gcd > 1; arbitrary-denomination fallback retained. Actual amount-manager desktop first inspection: 533.53 ms → 0.872 ms on a 40-proof fixture. Independent reachable-sum model plus existing property tests; actual machine tests for pending, repeated submission, online/offline and fiat behavior. |
| Suggestions stale despite an unchanged balance | Ready proofs include reserved proofs; equal-total changes did not invalidate the snapshot. | Exclude operation-reserved proofs from suggestions. Six manager-scoped proof events invalidate immediately and coalesce into an active/trailing read. Tests cover denomination replacement, reservations, event bursts, profile replacement and cleanup. |
| Send completion waits for unrelated history | The shared helper read 50 history entries to locate a known send operation. | Read Coco’s canonical operation history ID directly, preserving authoritative status, fee/memo/unit metadata and existing fallback. Four operation regressions cover direct/offline and missing/mismatched history. |
| Cancel ecash looks inert | Overflow closes immediately while rollback is pending; the destination ignored action loading. | Scroll to the existing timeline and animate its pending checkpoint; retain the visible QR with competing actions disabled. Confirmed rollback morphs the checkpoint and reanchors after QR removal; failure restores the pending timeline. The action manager rejects duplicate pending invocations before awaiting. Success/failure remain authoritative; no optimistic balance manipulation. |
| Notifications → App crash | FlashList emits outgoing tokens whose old indices no longer exist in the new, shorter data array. The logging adapter invoked item.id on undefined. | Preserve outgoing key/index metadata and skip item callbacks for absent data. Real logging-hook regression reproduces the logged exception before the fix. |
| Additional `.slice` crashes | Swift and Kotlin both emit BitChat peer-list events without peerID; the TypeScript event type and hook assumed individual peers only. | Native-event discriminated union and corresponding list/individual handling. Mounted-hook regressions use both bridges' exact payload forms, including an empty list. |
| Nostr detail blank at entry | The seeded thread hook was ready, but Screen deferred mounting the entire ThreadView. | Synchronous ThreadScreen content. Test presses actual PostCard twice and renders ThreadScreen → Screen → ThreadView/useThread; known target is present immediately and initial anchor index stays zero. Native FlashList measurement is mocked; optical/native first-paint timing remains unmeasured. |
| Double-opened routes/modals | Some callers bypassed the existing guard; three Link wrappers also bypassed it. | All imperative opening callers use the existing guarded router; parameter signatures ignore object-key order. ESLint prevents raw router/useRouter/Link imports outside the adapter. The explicit `.raw` escape hatch remains available for intentional duplicate navigation, with no current consumers. Actual Expo StackRouter test demonstrates raw PUSH duplication versus one guarded route. Custom popups already share a single payload host; they were not given a competing navigation system. |
| QR Display sluggish | Five receive rails could mount QR trees under display:none; hidden trees still encoded and animated. | Data hooks stay mounted for preloading, but only the selected rail mounts its visuals. Tests verify hidden QR count zero, visible count one, and teardown when switching away. |
| QR card shifts when data arrives | The old skeleton was 256 px while the real card was screen-width-derived (361 px on a 393 px screen). | Shared QR frame and sizing function for live and blank cards, including light/dark chrome and large-screen cap. Pending send-token detail reserves this blank frame before token data arrives; the shared transaction shell mounts its known scaffold synchronously. The QR-specific frame is static, with no extra crossfade or shimmer implementation. |
| Payment request / BOLT12 offer skeletons poorly match rows | Skeleton bar heights diverged from actual ListGroup title/description typography and badge layout. | Skeletons use the same row container and typography as real rows, with a whole-card skeleton treatment. Presentation tests check the shared dimensions and content transitions. |
| Mint import lacks responsive progress/outcomes | Only a button label changed; recovery failures were swallowed, and arbitrary 100 ms/50 ms delays preceded automatic dismissal. | A synchronous pending latch and per-mint connection/recovery stages internally; the UI shows one canonical LoadingIndicator, a short heading and one contextual line. Completion stays visible until Done. Partial import and recovery failure are separate outcomes. Manager identity checks prevent starting subsequent work after a profile switch; native-stack removal is blocked while the operation runs. Tests cover duplicate taps, ordered restore, partial success, normalized URL dedupe, profile switch and unmount. |
| Receive Address blank for non-sat | The component returned null. | Explain Bitcoin-only address receiving and offer the shared unit picker in the header on both platforms. Selection updates active unit, resets incompatible machine context, then updates route data. In-flight actions block switching; unit-keyed rail state prevents stale QR/copy payloads. |
| Map warm opens delayed; filter can stay blank | All builds, even cache hits, waited through deferred scheduling; empty filters retained comparison/tap refs. | Warm cached index paints directly, covered routes cancel queued cold work, empty filters clear all marker refs. Four regression cases. Cold Supercluster CPU cost remains unresolved. |

## Source checks

The second pass checked installed versions and source, not generic React advice:

- Expo Router 56.2.11 uses push semantics that permit duplicate routes. This project retains its existing guarded navigation seam instead of introducing globally singular routes that could alter back-stack behavior. [Expo Router source](https://github.com/expo/expo/blob/main/packages/expo-router/src/useScreens.tsx).
- FlashList 2.3.2 `src/recyclerview/viewability/ViewabilityManager.ts` indexes changed tokens against current data and explicitly supports undefined items. Application logging must handle that boundary. [FlashList source](https://github.com/Shopify/flash-list/blob/v2.3.2/src/recyclerview/viewability/ViewabilityManager.ts).
- Native-stack removal needs usePreventRemove rather than a bare beforeRemove event; this is used for mint-import ownership. [React Navigation guidance](https://reactnavigation.org/docs/preventing-going-back/), [native event limitations](https://reactnavigation.org/docs/navigation-events/).
- Coco 2.0.0 operation ownership/reservation/rollback and cashu-ts 5.0.0-rc.4 fee-aware proof selection were inspected at exact upstream commits. The app's composition optimization does not replace cryptographic output creation or funds-selection algorithms. Exact source links and the payment test matrix are in [the ecash report](2026-09-09-ecash-interaction.md).
- Supercluster 8.0.1 load builds the full hierarchy synchronously; its demo runs that in a browser worker. A timer only postpones blocking. [Supercluster implementation](https://github.com/mapbox/supercluster/blob/v8.0.1/index.js), [worker demo](https://github.com/mapbox/supercluster/blob/v8.0.1/demo/worker.js). A React Native worker/native alternative needs its own lifecycle, data-transfer, cluster-identity and both-platform tests.

## Validation

Final combined automated results: **5,042 tests passed**. Development-log timings and desktop microbenchmarks establish causes and removed work; they are not release-device FPS measurements.

| Gate | Final result |
| --- | --- |
| App Jest | 352 suites, 3,565 tests, 160 snapshots passed |
| Wallet Vitest | 82 files, 1,207 tests passed |
| Nostr Vitest | 30 files, 270 tests passed |
| TypeScript | App iOS and Android, wallet and Nostr passed |
| ESLint | Zero errors, 136 warnings |
| Formatting and dependency analysis | Prettier and root Knip passed |
| Styling and native header guards | Passed; no styling ratchet increases |
| React Compiler | 913 compiled functions, 97 known bailouts in 33 files, no new bailouts |
| Diff whitespace | Passed |
| Hermes export | Final iOS and Android exports passed |

The component inventory snapshot intentionally adds the shared QR frame (234 → 235 components); no rendered-layout snapshot was accepted merely to silence a mismatch. Initial failing tests were reproduced before fixes and the complete suite was rerun after integration. Logs are in `/tmp/sovran-second-{app-tests-final,wallet-tests-final,nostr-tests,types-final,lint-final,pretty-final,knip-final,styling-final,compiler-final,export-final}.log`.

Final Hermes artifacts are in `/tmp/sovran-second-native-export-final`: iOS bytecode 16,392,932 bytes, Android 16,559,544 bytes. These are Metro/bytecode exports, not native builds. A retry was needed after local disk exhaustion; only earlier temporary export directories created by this task were removed. Earlier export paths in the first-pass report are superseded by this final artifact. Existing cborg/noble-hashes package-export warnings remain.

A paired iPhone 12 is visible to devicectl, with the development app installed. The project's WebDriverAgent startup reported no USB device and its local endpoint was unavailable. No iOS simulator was booted and no Android device was attached. Consequently this pass does not claim native screenshots, optical QR scans, funded transfers, native gesture correctness or release-build frame-time measurements. No device state was reset.

The earlier service probes still require deployment investigation: intended Nagg app-view and Routstr model endpoints returned 404, whereas the version API and Bitcoin block/fee endpoints responded. No speculative provider switch was made. The first report's Hermes/toolchain caveat, very large transaction-section virtualization, remaining cold map work, and live payment recovery/outage testing remain open; the app is not certified exhaustively optimized.

## Cancellation and mint-import visual follow-up

The cancellation banner and blank-QR replacement have been removed. The existing timeline owns the pending and confirmed-result animations, with scroll anchoring through QR removal. Failed cancellation restores the actual pending state and keeps the token available. Mint import now presents only one status symbol, a short heading and one contextual line, retaining a truthful warning for incomplete recovery or partial imports.

After this UI follow-up, all 352 app suites / 3,568 tests / 160 snapshots passed. Both platform typechecks, changed-file ESLint (zero errors; seven existing warnings), formatting, styling guard, React Compiler guard and diff whitespace checks passed. Wallet/Nostr results and Hermes artifacts above predate this UI-only follow-up. A fresh iPhone automation attempt saw the USB device, but WebDriverAgent failed to become ready within 120 seconds, so scrolling and animation timing still need physical-device visual validation. Logs: `/tmp/sovran-polish-{app-suite,types-final,lint-final,test-lint,compiler-final,styling-final,wda}.log`.

## Transaction-opening AppState regression

The animated QR hook registered `blur` and `focus` listeners on iOS as well as Android. React Native maps these to `appStateFocusChange`, but the installed iOS `RCTAppState` only supports `appStateDidChange` and `memoryWarning`. The listeners are now Android-only; both platforms retain app-state and route-focus cleanup. [AppState event support](https://reactnative.dev/docs/appstate).

The QR lifecycle test now runs against both platform contracts and rejects unsupported iOS subscriptions. Before the fix, all 11 iOS cases failed at QR mount while the 11 Android cases passed; afterward all 22 passed. The original permissive event mock masked this platform error. Together with payment-card and transaction-detail tests, 37 tests passed, as did both platform typechecks, scoped lint, formatting, the React Compiler guard and diff whitespace checks. The latest redacted development log did not contain the exact native error; this reproduces the reported focus-state failure at the actual QR hook using the installed native event contract. No new physical-device validation was performed. Logs: `/tmp/sovran-qr-focus-{red,green,types,lint,compiler}.log`.
