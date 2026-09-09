# Sustained heat investigation — 2026-09-09

Sovran has identifiable sources of sustained work that deserve targeted fixes before broad rendering refactors. The strongest runtime evidence is repeated mint polling through rate-limit errors. Source inspection also finds a permanently registered animation callback, continuous wallpaper motion, frequent reachability probes, and persistent BLE discovery after use.

These are observations and ranked candidates, not a confirmed thermal diagnosis. No CPU, GPU, battery, or temperature trace was captured. The initial investigation was read-only; the subsequently authorized implementation is recorded below. The numbered findings retain the pre-change evidence.

## Implemented changes

- **Coco polling:** a checked-in Bun patch for `@cashu/coco-core@2.0.0` preserves HTTP `Retry-After` (seconds or date), increases failed polling intervals exponentially with jitter, and applies cooldown across polling subscriptions at a mint. Local exponential delay caps at five minutes; a longer server delay is respected. Failure history travels with queued tasks so another successful task does not reset it. Both returned failure outcomes and thrown exceptions are handled. Pending records are retained and successful observations still reach subscribers. Closing or pausing transports cancels timers; late completions cannot recreate a closed poller. Also fixed `closeMint` missing an injected/shared polling transport, and the last proof subscriber leaving during a request.
- **Visual lifecycle:** `useVisualActivityEffect` directly observes navigation and app/window activity, so cleanup does not depend on a frozen screen rerendering. Loading indicators register their frame callback cold and activate only while spinning; completed/static indicators remain inactive. Segment breathing stops on blur/background. This gates screen activity, not individual list-row viewability.
- **Wallpaper:** sensor updates reduced from 20 Hz to 10 Hz, with a 0.25-point movement deadband before starting another spring. Focused foreground wallpaper owns the shared sensor; an image on a hidden carousel page alone no longer retains it. The existing system Reduce Motion setting remains the static-motion option; no persisted settings schema was changed.
- **Reachability:** healthy steady-state checks reduced from once every three seconds to once per minute. Failure confirmation remains fast, followed by retries backing off to one minute. Network and foreground events still revalidate immediately subject to the existing coalescing/overlap guards. Timer scheduling occurs after a check rather than continuously waking every three seconds.
- **BLE:** peer refresh/start listeners now follow visible foreground screens, without stopping mesh delivery. iOS opens a thirty-second full-discovery window on explicit BLE start/focus, then uses five seconds scanning / ten seconds idle when quiet, including with no neighbors; existing denser-network intervals are retained. Recent traffic retains full scanning. Duplicate scan reports are limited to the discovery window. Advertising and established connections remain running. Android charging in foreground now uses the existing balanced discovery mode instead of automatically selecting continuous performance scanning. Changes are encoded in the existing vendor patch/copy workflow, not committed inside upstream submodules. Idle discovery can take longer to find a new peer.
- **Logging:** Coco metadata is not traversed when its log level is disabled. Routine development source-stack capture requires `EXPO_PUBLIC_LOG_STACKS=1`; error/fatal source capture remains enabled. The development heartbeat requires `EXPO_PUBLIC_JS_THREAD_MONITOR=1`. Existing file logging remains separately opt-in.

These changes are local and uncommitted. Dependency versions are unchanged; the lockfile records the Coco patch.

### Verification and remaining device checks

Regression coverage exercises actual installed Coco through its public subscriptions API with in-memory repositories and mocked HTTP, including a later paid observation after 429, increasing backoff, HTTP-date cooldown shared with a new subscription, pause/resume, closing a mint, late request completion, proof-state retry, and final unsubscription. App tests cover connectivity cadence/hysteresis, lifecycle cleanup, motion deadband, disabled logger work, and completed indicator deactivation. Design-system snapshots are unchanged.

Completed checks: 355 app suites / 3,595 tests / 160 snapshots passed; 83 wallet suites / 1,212 tests passed, followed by the expanded seven-case polling contract suite. App iOS/Android and wallet TypeScript checks passed, as did changed-file formatting, knip, and `git diff --check`. Focused ESLint had no errors (one existing `require()` warning; native patch scripts are excluded by the app lint configuration and were checked with Node). Structural analysis completed with its repository-wide findings.

The iOS discovery patch was applied to pristine vendor source and checked for idempotence, and Swift parsing succeeded. The Android source-copy patch and existing Android native-source tests succeeded. **These checks do not replace a native build or two-device BLE test.** Generated app native projects are absent from this checkout; no native app was rebuilt or installed. In a rebuilt app, verify discovery after the idle window, new peers arriving during scan gaps, and send/receive completion after leaving Nearby. Then perform the matching Release power comparison described below. No thermal improvement percentage has been measured.

## Evidence boundary

- Checkout: `d2fefe61239b3a5fe522189341cf7287d052d247`, branch `perf/app-responsiveness-2026-09-09`; initially clean.
- Declared versions: Expo `^56.0.16`, React Native `0.85.3`, Reanimated `4.5.1`, Coco Core `2.0.0`. Installed Expo resolves to `56.0.20`; installed RN/Reanimated match those declarations.
- Examined app initialization, wallet watcher configuration, animation registry implementation, wallpaper, network reachability, logging, BLE lifecycle, and selected media paths.
- Examined the final 150,000 lines of the existing `app/log.txt`, using the repository parser after its redaction audit. Full-file log-doctor refused the 130 MB file. The bounded sample contains 4,969 parsed entries over 592.1 seconds, from **20:22:43 to 20:32:35 UTC on September 9**. This is a partial development-session window, not an entire session or a measured idle test. The phone's screen, interaction, charging state, fault-injection state, and exact running commit are unverified. Do not project these counts onto production.
- Log redaction scan found no high-signal raw secrets. Only aggregate counts and normalized endpoint types are recorded here; no wallet values, identifiers, or log payloads are copied.

## 1. Give mint polling error-aware backoff

The sample contains:

| Observation | Count |
| --- | ---: |
| Mint request events | 585 |
| Mint error responses | 324 |
| HTTP 429 responses on BOLT11 quote checks | 220 |
| HTTP 400 responses on BOLT11 quote checks | 87 |
| Other error responses without a numeric HTTP status | 17 |
| Database transaction start events | 1,121 |
| NUT-18 transport poll completions | 40 |

Two anonymized mint/endpoint groups account for 111 and 109 rate-limit responses, respectively, with mean error spacings of **5.35 and 5.41 seconds**. That establishes repeated failed activity in this sample. It does not establish why the mint returned each error or how much energy these calls consumed. Transaction logs count database transactions, not necessarily writes, fsyncs, or independent network requests.

[Manager construction](../../app/shared/lib/cashu/manager.ts#L538) leaves subscription intervals at Coco defaults. [Watcher startup](../../app/shared/lib/cashu/manager.ts#L714) restores existing pending operations and reusable quotes. The installed `@cashu/coco-core/dist/index.js` has:

- `PollingTransport.maybeRun`, around line 8550: a per-mint queue with a fixed next-allowed interval after processing; mint quote tasks are requeued.
- `performOpportunity`, around line 8607: consumes updated quote outcomes without adapting the schedule to failed outcomes.
- `classifyMintQuotePollingFailure`, around line 12883: already recognizes rate limits. Classification exists, but the inspected polling scheduler does not turn that classification into increasing cooldowns.
- Default fallback polling of five seconds, and backup polling of twenty seconds when using the hybrid transport. These are per-mint scheduler intervals, not a promise that every quote is queried at those exact intervals.

**Recommended fix:** carry error classification into scheduling. On 429, respect `Retry-After` when available and add bounded exponential backoff with jitter, coordinated across requests to that mint. Preserve live WebSocket delivery and resume reconciliation. Give transient connectivity/server failures backoff too. Investigate the precise protocol meaning of the 400 responses before deciding whether a quote is obsolete or requires intervention; HTTP status alone is insufficient.

Deduplicate subscriptions for the same quote and unsubscribe only when its lifecycle says observation is finished. Reusable BOLT12/onchain quotes and pending payments must remain recoverable. Do not delete pending records, mark an unpaid quote complete, or disable wallet processing to reduce traffic. The processor's configured `maxRetries: 3` is not a global retry limit for subscription polling.

This likely requires a Coco dependency fix or a supported transport extension. Do not hand-edit `node_modules` or change the sibling reference repository as part of an app-only fix.

The NUT-18 [transport](../../app/shared/lib/cashu/paymentRequestNostrTransport.ts#L139) also checks DM envelopes every fifteen seconds while it has active receive operations, with live relay delivery in parallel. Verify which outstanding operations justify that work. Its fallback protects reception after silent relay failure; removing it without replacing that recovery guarantee is incorrect.

## 2. Actually deactivate completed animation callbacks

[LoadingIndicator](../../app/shared/blocks/status/LoadingIndicator.tsx#L749) calls `useFrameCallback` with default autostart. When both speeds are zero it returns early, but never deactivates the registered callback. Even its static completed rendering path leaves the hook mounted. The component appears in transaction timelines and transfer steps, as well as spinners.

The installed Reanimated registry reschedules `requestAnimationFrame` while any registered callback is active. A small Node harness executed that actual registry with a simulated frame scheduler: an early-return callback ran **600 times over 600 simulated frames**, with another frame still queued. Deactivation drained the loop to zero queued frames. This verifies scheduler behavior, not device power consumption or whether such an indicator was mounted during the supplied log window.

**Recommended fix:** use `useFrameCallback(callback, false)` and explicitly activate it only for visible spinning/deceleration. Deactivate on completion, blur, background, and unmount; account for transition completion without cutting off the animation. Cancel repeating segment pulses when no longer visible. Test settled success/error states, pending states, navigation away/back, and recycled rows.

Reanimated documents both default autostart and `setActive(false)`. Returning early is not cancellation. [Reanimated frame callbacks](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useFrameCallback/)

## 3. Make wallpaper motion optional and visibility-aware

[wallpaperMotion.ts](../../app/shared/lib/theme/wallpaperMotion.ts#L22) subscribes to DeviceMotion every **50 ms** and starts a native-driver spring for every rotation sample, with no motion deadband. The sensor callback still reaches JavaScript; using a native animation driver does not remove that work.

[AnimatedBackgroundView](../../app/shared/ui/composed/BackgroundView.tsx#L312) retains the shared subscription if the current theme **or any registered carousel page** has an image wallpaper. Its retention condition checks reduced motion, but not screen focus or actual visibility. Thus a solid current page alone does not guarantee motion is stopped when another carousel page has an image. Hidden layers share the animated transform. Existing reference counting correctly prevents one sensor subscription per wallpaper layer.

**Recommended fix:** offer static wallpaper motion, retain the sensor only for visible foreground wallpaper, and stop springs when that visibility ends. If parallax is retained, ignore insignificant rotation changes and evaluate a lower update rate. Test the full carousel, not just the current theme. Measure before pursuing a native sensor rewrite; stopping unnecessary work is the first experiment.

An immediate isolation test is the existing system Reduce Motion setting, applied before relaunch; this code already reads it. A decrease in energy would implicate motion broadly, so use a subsequent wallpaper-only change to attribute the result.

Apple recommends avoiding unnecessary redraws and ending animation when its purpose finishes. Smooth animation can still consume sustained power. [Apple rendering efficiency](https://developer.apple.com/documentation/xcode/improving-your-app-s-rendering-efficiency)

## 4. Replace constant reachability traffic with adaptive checks

[OfflineProvider](../../app/shared/providers/OfflineProvider.tsx#L26) checks every **3,000 ms** while active. [offlineReachability.ts](../../app/shared/lib/offlineReachability.ts#L47) sends an uncached POST to the application's latest-version endpoint on each connected-state evaluation. That is approximately **20 requests/minute, or 1,200/hour**, under healthy steady conditions, before extra listener-triggered checks. This is a source-derived rate; the request bypasses the regular API logger and is not included in the mint-request count above.

The provider already has an overlap mutex, network events, offline hysteresis, and background timer cleanup. Preserve those safeguards.

**Recommended fix:** primarily revalidate on foreground, connectivity changes, and relevant request failures; keep a slower periodic safety check with backoff when stable. A 30–60 second interval is an initial experiment, not a proven optimum. Prefer a lightweight reachability endpoint or reuse recent successful network evidence where its semantics match. Do not equate a network connection with working internet, or a single backend failure with every mint being unreachable.

Apple recommends reducing timer wakeups and batching networking. [Timer guidance](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/EnergyGuide-iOS/MinimizeTimerUse.html), [network and Bluetooth power](https://developer.apple.com/documentation/xcode/reducing-networking-and-bluetooth-power-usage)

## 5. Bound BLE discovery after leaving nearby features

BLE is not started by the root provider at fresh launch. [useBLEPeers](../../app/features/bitchat/hooks/useBLEPeers.ts#L119) starts it on feature mount; ordinary Send and user message-menu surfaces also consume this hook. Cleanup removes listeners but does not stop the native service. The root provider deliberately preserves DM and payment delivery after screen exit.

The vendored iOS `BLEService.swift` uses duplicate discovery in foreground and explicitly forces continuous scanning with at most two connected neighbors (`updateScanningDutyCycle`, around line 4514). It adapts for background and dense networks, so describing it as having no lifecycle or power controls would be inaccurate.

**Recommended fix:** compare cold-launch wallet idle with wallet idle after opening Send/Nearby. If BLE is material, introduce explicit discovery ownership and a bounded discovery window, while retaining service for in-flight sends and intentionally enabled incoming mesh reception. Do not blindly stop BLE whenever one consumer unmounts.

## 6. Reduce development instrumentation overhead

[loggerCore](../../app/shared/lib/loggerCore.ts#L697) is gated off in release, but in development emitted entries capture stack locations, compact parameters, and serialize structured output. [loggerJsThread](../../app/shared/lib/loggerJsThread.ts#L25) adds a 200 ms development heartbeat. Optional file logging batches synchronous appends; it defaults off.

The sample's 4,685 debug entries amplify its repeated network/database activity. [CocoCoreLogger._emit](../../app/shared/lib/cashu/cocoLogger.ts#L212) also builds and sanitizes metadata before reaching the release-disabled sink: add an early `cashuLog.isLevelEnabled(level)` check there so disabled logs skip this preparatory work too. Preserve redaction on emitted logs.

**Recommended fix:** opt into expensive debug categories and stack capture during focused diagnosis, disable file logging for a clean baseline, and make the heartbeat opt-in. `LogBox.ignoreAllLogs()` hides warnings; it does not disable these emitters. Avoid adding more continuous logs to diagnose heat.

React Native recommends performance testing in release and identifies logging as a possible JS bottleneck. [RN performance](https://reactnative.dev/docs/performance)

## Validation plan and implementation order

1. **Baseline first.** Use the affected physical phone, same account data, screen, backend, network, brightness, and charging state. Cool between runs. Separate startup/recovery from a ten-minute settled foreground interval. Compare development with native Release, and repeat the release baseline to establish variance. A paired iPhone was discoverable, but no reproduction or energy recording was performed.
2. **Prioritize wallet retry backoff**, because repeated 429 traffic is observed. Verify error cadence falls, pending payments still complete, WebSocket recovery works, and account switches leave no prior-account subscriptions.
3. **Deactivate idle indicator callbacks and gate wallpaper motion.** These are narrow fixes to demonstrated continuous-work mechanisms. Compare idle CPU/render activity, including after navigating away from the relevant screen.
4. **Reduce reachability polling**, retaining offline/recovery correctness. Measure requests per minute and connectivity recovery latency.
5. **Test BLE history and development logging separately.** Apply changes only to the subsystem the trace implicates.

The existing EAS `preview` profile is internally distributed without the development client and shares development's backend settings. Production uses different backend URLs, so a dev-versus-production comparison otherwise changes more than build mode. [Expo build profiles](https://docs.expo.dev/build/eas-json/)

For a local Release build, run from `sovran-app/app` with the intended variant and backend configuration:

```sh
bun expo run:ios --configuration Release --device
# Android alternative:
bun expo run:android --variant release --device
```

These commands were not run; native generation and signing may be needed. Use an existing test installation/configuration that preserves wallet state. The repo's `build:ios`/`build:android` wrappers update dependencies, clean native projects, and auto-submit, so they are unsuitable for an unchanged diagnostic baseline. Metro `--no-dev` alone is not a native Release build. [Expo local builds](https://docs.expo.dev/guides/local-app-development/)

On iOS 26+, record **Instruments Power Profiler plus CPU Profiler/Time Profiler** to distinguish CPU, GPU, and network work. Use a wireless/on-battery power run and separately test background behavior. On Android, use Android Studio System Trace and Power Profiler where supported; ODPM power rails are device-wide and require supported hardware. [Apple Power Profiler](https://developer.apple.com/documentation/xcode/measuring-your-app-s-power-use-with-power-profiler), [Apple profiling demonstration](https://developer.apple.com/videos/play/wwdc2025/226/), [Android Power Profiler](https://developer.android.com/studio/profile/power-profiler)

Use RN DevTools for JS/React attribution after locating the busy subsystem. Its network panel does not capture WebSocket events, and a quiet React commit timeline cannot exclude BLE, GPU, or native work. [RN 0.85 DevTools](https://reactnative.dev/docs/0.85/react-native-devtools)

Success means lower sustained power/CPU/render/network activity beyond run-to-run noise, with payment completion, resumption, and interaction behavior preserved. No percentage improvement can responsibly be promised from this investigation.
