# Fast store screenshots and harness review

Reviewed 2026-09-11 against the current working tree. The checkout contains
unrelated ongoing app, scenario, and release changes; those were preserved.

## Current richer demo captures

Both journeys passed with the fuller photo feed, seven public notifications,
four fictional conversations, real public avatars in Send, and the corrected
profile header. All 28 images were visually reviewed. Mode-off assertions passed
and both owned devices were disposed. Minibits appeared automatically in both
fresh wallets.

| Platform | End-to-end time | Export directory |
| --- | --- | --- |
| iPhone | 486.1 s (8m 6s) | [Current iPhone exports](../e2e/artifacts/run-2026-09-11T18-03-58-075Z-813d671c/store/) |
| Android | 658.8 s (10m 59s) | [Current Android exports](../e2e/artifacts/run-2026-09-11T18-14-26-766Z-b2d378ae/store/) |

Each gallery has fourteen opaque RGB PNGs: 1320×2868 for iPhone, 1080×1920
for Android. App Store/Freedom selections contain ten images; Play/Zapstore/APK
selections contain eight. All target ZIPs passed integrity, manifest membership
and byte-identical HTTP download checks. Nothing was published.

The Android system image still draws duplicate network status icons. An earlier
onboarding capture also exposed unresolved color tokens; that separate theme
issue is recorded in [the demo review](testing-public-demo.md). Neither limitation
is claimed fixed. Current focused verification passed 18 app tests, 83 harness
tests, both platform TypeScript checks, focused ESLint and whitespace checks.

## Capture setup follow-up

The fast scenario uses the real terms controls followed directly by Get Started;
it does not replay the tutorial carousel. Build discovery ignores temporary E2E
simulators so cleanup cannot remove the selected source app. The owned Android
AVD keeps its 6 GiB data partition. The pinned Play system image requires 7.2 GiB
of host space even when a smaller partition is requested. Boot now waits up to
60 seconds for at least 7.3 GiB free, allowing macOS to reclaim a recently deleted
iPhone simulator before failing. No unrelated files or devices are deleted.


## Previous public account captures

The follow-up [public demo snapshot](testing-public-demo.md) uses the requested
kelbie npub, reviewed public feed/notifications, and the user's X avatar bundled
locally. Notification previews now resolve NIP-19 mentions to readable names.
Both final journeys passed, including restoration of the real test-wallet
identity when Mock Mode is disabled. All 28 images were visually reviewed;
archive manifests, PNG formats and HTTP downloads were verified.

| Platform | End-to-end time | Export directory |
| --- | --- | --- |
| iPhone | 470.1 s (7m 50s) | [Latest iPhone exports](../e2e/artifacts/run-2026-09-11T15-49-19-366Z-ac8ab49c/store/) |
| Android | 727.6 s (12m 8s) | [Latest Android exports](../e2e/artifacts/run-2026-09-11T15-36-43-979Z-855860c1/store/) |

The following expanded/baseline runs are retained as historical evidence.

## Final expanded captures

The final iPhone and Android journeys passed with fourteen named images each.
All twenty-eight images were opened for visual review. The runs enable demo
content through Settings, visit the selected pages, disable Mock Mode, assert
that demo wallet history and feed disappear, and dispose their owned devices.

| Platform | End-to-end time   | Export directory                                                                 |
| -------- | ----------------- | -------------------------------------------------------------------------------- |
| iPhone   | 462.9 s (7m 43s)  | [iPhone exports](../e2e/artifacts/run-2026-09-11T13-50-13-970Z-2980aa1f/store/)  |
| Android  | 673.4 s (11m 13s) | [Android exports](../e2e/artifacts/run-2026-09-11T14-13-24-680Z-24ddb08d/store/) |

App Store/Freedom archives contain ten images; Play/Zapstore/GitHub archives
contain eight; the website and gallery archives contain all fourteen. The PNGs
are opaque sRGB at 1320×2868 on iPhone and 1080×1920 on Android. ZIP contents and
HTTP downloads were checked against their manifests. No assets were published.
The Android system image can render duplicated network status glyphs despite
its demo-mode override; this cosmetic emulator limitation remains.

The Android iterations caught two additional harness bugs. A history sheet
exposes transaction IDs also present in the wallet behind it: selector matching
now chooses the last on-screen copy before indexing rows. The full tree stays
intact for redaction. A relaunch also landed on Android's home launcher; the old
success check accepted any nonempty XML outside the Expo launcher. It now
requires Sovran's package in the visible window and retries a dropped deep link,
without restarting an active bundle download. Red-to-green owner tests and the
final native journey verify these fixes.

A first Android boot failed because iPhone deletion had not yet released enough
disk space. It succeeded after space became available, without deleting shared
AVDs or user data. That historical run used a 6 GiB data partition and required at least 7.4 GiB
available at boot. Leave additional host space for app installation, Metro and captures; the
current preflight only guards the observed emulator minimum.

The gallery is a presentation check. It does not establish payment settlement,
AI keyboard/streaming behavior, or every gesture on every route. Those remain
separate owner/native scenarios under SYSTEM.md decision 26.

## Original eight-page baseline

Both original native journeys passed on 2026-09-11, with eight named images and one
final-state capture each. All sixteen selected images were opened for visual review.

| Platform | End-to-end time  | Export directory                                                                       |
| -------- | ---------------- | -------------------------------------------------------------------------------------- |
| iPhone   | 288.9 s (4m 49s) | [iPhone store exports](../e2e/artifacts/run-2026-09-11T12-39-38-403Z-f4df8257/store/)  |
| Android  | 396.0 s (6m 36s) | [Android store exports](../e2e/artifacts/run-2026-09-11T13-03-30-689Z-a0d657eb/store/) |

The final PNGs are opaque sRGB: iPhone 1320×2868, Android 1080×1920. All seven
platform-specific target ZIP downloads returned HTTP 200 and matched their local
archives byte-for-byte. No media has been published.

## Expanded gallery and Mock Mode repair

The expanded iPhone diagnostic run `2026-09-11T13-34-30-073Z-041f99d2`
passed all fourteen pages and mode-off assertions in 468.4 seconds. It is a
**diagnostic artifact**, not the final upload set: editing source during that
run caused a development refresh banner in one image. Freeze source during
capture and visually review exports before upload.

Native images exposed a collapsed nested mint-info button, a receipt fixture
still in PAID (payment received but ecash not yet issued), missing demo author
names, and the AI response docking behind its composer. The shared ListRow now
exposes its main and trailing actions as native siblings. The receipt uses
ISSUED. Demo names are selected at the profile read boundary. AI reserves the measured composer's height outside the list viewport so
short-history bottom alignment cannot place the latest response behind it.

The old Mock Mode injected data into live stores while skipping immediate
persistence. Subsequent writes and the delayed entity-cache mirror could still
persist it; repeated activation also leaked hydration listeners. Demo histories,
profiles and swap groups now stay in runtime fixtures. A content-matched upgrade
cleanup removes identifiable legacy entries without deleting genuine profiles
that share a historical fixture's public key. DM demo messages now have separate
local state, fixing a reproduced enable → disable leak in mounted conversations.
Feed/notifications remount isolated instances when mode changes; AI demo replies
stay local and never call a provider. See SYSTEM.md decision 26 for the contract.

Minibits is already the first of four configured defaults. On this host, curl,
Bun and Python all failed the Minibits TLS handshake during review. Registration
must succeed before it becomes trusted; the screenshot setup explicitly selects
an available mint. Six default-initialization tests cover retry, partial failure
and preserving an existing selection. No certificate check was bypassed.

All 111 native route entries are now catalogued across 82 routed page identities.
`bun run e2e:pages` generates [the platform inventory](testing-page-testability.md);
a harness test rejects new route files absent from the catalog. Authored
screenshots are candidate journeys, not proof of every gesture or route alias.

## Capture workflow

From `sovran-app/app`:

```sh
bun run shots:store          # both phones, sequentially
bun run shots:store ios      # iPhone only
bun run shots:store android  # Android only
bun run e2e:viewer           # http://127.0.0.1:4700 → Store screenshots
```

The dedicated viewer workspace offers **Capture both**, **iPhone only**, and
**Android only**, plus individual PNG downloads and a ZIP for each completed
platform. Regression-run and deletion controls are hidden while this workspace
is selected. Launch commands are available under a disclosure in the run dialog.

Each platform creates one disposable device and one Metro session. Existing
simulators, shared Android AVDs, wallet data, and the counterparty wallet are not
reset or funded. This suite enables Mock Mode through Settings for wallet
history/balance, feed, notifications and an AI conversation. Its verification
phase disables the mode and asserts the demo history/feed disappear. Contacts shows
four fictional conversations alongside reviewed public profiles; real private
conversations are excluded. It does not
perform sends, mint payments, redeem tokens, or publish messages. These are demo
presentation images, not evidence that a payment settled.

The fourteen-image review gallery contains:

1. Wallet with balance and activity.
2. Contacts.
3. Public contact profile.
4. Balance split across available mints.
5. Receive method chooser.
6. Standing receive QR.
7. Send method chooser.
8. Mint selection.
9. Mint info.
10. Transaction history.
11. Completed Lightning receive details.
12. Home feed.
13. Notifications.
14. AI conversation.

Outputs live under `e2e/artifacts/run-<id>/store/`: fourteen numbered PNGs,
`manifest.json`, `README.txt`, `screenshots.zip`, and labeled store ZIPs. Export requires a passing native run and
exactly one capture of each selected page. Missing, duplicate, invalid-size, and
fully blank/masked frames fail export. The manifest explicitly identifies demo
content, platform, source fingerprint and Git state. The archive contains only
the selected images and their provenance, not private AX, state, or database
sidecars. The original captures retain the harness's existing masking behavior.
Visual review remains required: these checks cannot detect every misplaced menu,
loading state, clipped label, or partially masked region.

The iPhone session prefers iPhone 17 Pro Max. Export accepts Apple's current
6.9-inch portrait sizes (1320×2868, 1290×2796, 1260×2736). Android applies a
1080×1920 display override at 320 dpi to its owned emulator before launch.
The matching density preserves enough logical height for the fixed QR footer. PNG export flattens
alpha onto black and normalizes to sRGB. iPhone dimensions remain native. Android
sources at least 1080×1920 are fitted into 1080×1920 with proportional scaling and
black padding when necessary; no content is cropped or stretched. Source dimensions
remain in the manifest. Apple permits up to ten screenshots;
Google Play permits eight per device type. App Store/Freedom exports select ten; Android store exports select eight.
[Apple specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/),
[Google Play specifications](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).

### Distribution targets

Checked against `release/config.json`, `release/hosting.mjs`, `release/freedom.mjs`
and `release/publish.mjs`, including the pinned zsp 0.4.17 interface:

| Target                   | Capture             | Export              | Submission detail                                                                                                                                                                   |
| ------------------------ | ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Store                | iPhone              | `app-store.zip`     | Ten opaque PNGs at a supported 6.9-inch resolution.                                                                                                                                 |
| Freedom Store / AltStore | iPhone              | `freedom-store.zip` | Host the PNGs and use HTTPS URLs in the source's `screenshots` array. The existing release pipeline reuses approved App Store media.                                                |
| Google Play              | Android             | `google-play.zip`   | Eight 1080×1920 phone images. A separate 1024×500 feature graphic is outside this screenshot set.                                                                                   |
| Zapstore                 | Android             | `zapstore.zip`      | Supply the PNG paths or hosted URLs to zsp's `images`. The current publisher preserves existing Zapstore images, so generating this export alone does not replace listing metadata. |
| GitHub APK               | Android             | `github-apk.zip`    | Optional release media, with no special phone screenshot dimensions.                                                                                                                |
| Website                  | Respective platform | `website.zip`       | Retain platform identity. Existing automated website publication uses approved App Store media.                                                                                     |

The phone selection is wallet, home feed, contacts, history, Lightning receipt,
notifications, AI and mint info. iPhone adds the public profile and receive QR.
Website and `screenshots.zip` retain all fourteen for review. Manifest version 3
records each target’s selected files. Archives contain that selection only; no
duplicated images are added to reach a store cap. No iPhone image is
converted into an Android image. No publication or external release-state mutation
happens during capture/export. Freedom's checker validates screenshot URLs, and
AltStore accepts Face ID portrait iPhone URLs directly. Neither the Freedom checker
nor the pinned zsp documentation defines a competing pixel-size requirement.
These are source-backed export choices, not a claim of store approval.

Sources: [Freedom source checker](https://github.com/freedomstore/freedomstore/blob/main/check.mjs),
[AltStore screenshot schema](https://faq.altstore.io/developers/make-a-source#screenshots),
[zsp 0.4.17 configuration](https://github.com/zapstore/zsp/tree/v0.4.17#configuration).

### cocod compatibility

The npm `cocod` dist-tag still resolves to 0.0.16. That daemon expects INTEGER
amounts, but this host's wallet already has migrations `024_amount_columns_text`
through `038_keypair_derivation_allocations`. Its old SQLite adapter returns text
unchanged and its core uses JavaScript `+`, concatenating amounts. Converting proof
rows back to numbers would not reverse the schema upgrade safely.

The host launcher now uses cocod 0.0.17 from
[Coco commit 6945ac4](https://github.com/cashubtc/coco/tree/6945ac41271bc2d1e26a9cc9fdcf8f5ab8076343/packages/cocod),
with core, SQL storage and Bun adapter from the same commit. Published core 2.0.0
does not export `CocoInitializationError` required by this source, despite the
source package retaining that version number. The source installation therefore
builds the matching workspace packages, with registry runtime dependencies locked
in its own `bun.lock`. It lives under `~/.local/share/cocod-source/<commit>/` and
records its adaptation in `INSTALL-PROVENANCE.json`; the app's dependencies are
unchanged. Private wallet/config/credential backup is under
`~/.local/share/cocod-backups/`.

A local startup fix also avoids re-registering an already trusted default mint.
The host's default mint returned a certificate-verification failure, and the
unconditional final `addMint` call otherwise disposed the recovered session.
New mint registration still requires a successful network response; TLS checks,
proof amounts, mint trust and wallet configuration are unchanged. Startup still
runs pending-operation recovery and can take several minutes when a mint is
unreachable. Do not confuse the process's `/health` response with a running wallet
session. This fix is recorded in the installation provenance and covered by two
isolated tests.

Do not run npm 0.0.16 against this upgraded database, delete `config.json`, or
initialize a replacement wallet to fix this display bug. `cocod status` now returns
JSON containing daemon, seed-access and session states. The runner accepts both
known CLI versions, but only maps a 0.0.17 **running** session with **available**
seed access to its internal `UNLOCKED` state. Malformed/string balances still fail
closed. The funded lane keeps its existing explicit wallet acknowledgement and
principal limits. Store screenshots use demo mode and do not require cocod.

## What changed and what was measured

The original eight-page `store-screenshots` scenario had 66 expanded steps.
On a first-attempt fake-driver execution of that baseline (the expanded
fourteen-page flow below has more actions):

| Evidence policy          | Screenshot calls | What remains                                             |
| ------------------------ | ---------------: | -------------------------------------------------------- |
| Existing full evidence   |               89 | Every step, retry sub-action, named page and final state |
| `--evidence screenshots` |                9 | Eight named pages and final-state proof                  |

This is 89.9% fewer screenshot calls, **not a measured 89.9% runtime improvement**.
Retries and failures add captures. The new policy also omits optional per-frame
app/database dumps at the CLI boundary. It retains all assertions, selector waits,
cleanup, reconciliation, failure screenshots/AX, and final-state checks. Full
regression evidence remains the default. `--no-record` disables the iOS video
recorder for store runs.

## Architecture and performance findings

This review traced schema/loader/selection, fixture expansion, core step execution,
CLI session ownership, both drivers, screenshot redaction, funded accounting,
orchestrator selection, viewer run planning, artifact scanning and rendering.
The legacy `.sov` path is retained for log-doctor consumers; it is not the current
store runner. This is a subsystem review, not a claim that every source line or
native scenario has been exercised.

| Area                 | Source-backed finding                                                                                                                                                     | Decision                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Suite selection      | Before this addition, `full` had 126 scenarios and 125 session boundaries. The new full inventory is 127/126; the capture suite is 1/1.                                   | Capture one journey rather than running separate regression scenarios for each page.                                            |
| Evidence fan-out     | `core/run.ts` captures after steps and retry sub-actions; named screenshot steps already avoid a duplicate capture.                                                       | Add an explicit opt-in evidence policy, keeping failures and final proof.                                                       |
| iOS interactions     | `serve-sim` 0.1.44, AX observation, normalized touch coordinates and one connection per press are already used. Down/up share a WebSocket.                                | Refresh native AX after taps/swipes independently of screenshot capture. Appium-specific settings do not apply.                 |
| iOS screenshots      | Pause AX watcher, fetch pre-capture geometry, run simctl screenshot, fetch post-capture geometry, mask and encode, then restart watcher. A 450ms settle precedes capture. | Reduce capture count; preserve both geometry checks. Add a 10s bound to the helper HTTP fetch.                                  |
| Android interactions | Every fresh hierarchy uses a shell UIAutomator dump; caching and in-flight coalescing already exist.                                                                      | A persistent instrumentation service is the strongest next interaction experiment; benchmark before replacing the backend.      |
| Android screenshots  | Each image includes a 450ms settle and two fresh hierarchy dumps around `adb exec-out screencap -p`. Unknown geometry produces a black frame.                             | Keep this privacy boundary; the store exporter rejects fully black/blank output.                                                |
| Re-entry             | `goHome` reloads/relaunches and then selects Wallet, with an additional 1.8s refresh-overlay wait.                                                                        | Future work: a separately tested dismiss-to-wallet operation can save reloads. Do not alter funded-sweep relaunch semantics.    |
| Session cost         | Each session starts Metro and creates a fresh device; ordinary scenario grouping already exists, funded scenarios stay isolated.                                          | Use one session for the whole presentation journey.                                                                             |
| Android animation    | Existing code deliberately keeps animation scales at 1; setting them to zero changes Reanimated reduced-motion behavior and has broken onboarding.                        | Do not disable animations globally to claim faster equivalent tests.                                                            |
| Native binaries      | iOS auto-discovers a development app by bundle ID and entitlements, not dependency compatibility. Android expects a prebuilt debug APK.                                   | Missing/stale binaries need rebuilding. A future native dependency fingerprint should reject incompatible binaries before boot. |
| Viewer               | Existing trigger always expanded across supported platforms and only allowed Default/Full suites.                                                                         | Allow explicit platform selection, add the focused suite, show complete downloadable store sets separately from debug evidence. |
| Audit contracts      | The fresh-matrix audit intentionally pins inventory counts in production and tests.                                                                                       | Update to 127 scenarios / 217 pairs (118 iOS, 99 Android); keep duplicate and viewer/CLI parity checks.                         |

### Research and deferred experiments

- Android Quick Boot snapshots preserve OS settings, app state and user data.
  They could reduce boot/onboarding cost, but must be versioned against the app,
  system image and fixture revision, copied into an owned disposable AVD, and
  excluded from real funded custody. Restoring a shared wallet snapshot would
  invalidate isolation. No snapshot cache was added in this change.
  [Android snapshots](https://developer.android.com/studio/run/emulator-snapshots).
- Android's newer UI Automator API supports predicate-based element lookup,
  app visibility waits and stability waits. A small persistent test service could
  avoid starting a shell hierarchy dump for each poll. That is an architectural
  experiment, not a drop-in shell flag or a measured speedup here.
  [Android UI Automator](https://developer.android.com/training/testing/other-components/ui-automator).
- Upstream serve-sim documents keeping a tap's down/up events on the same
  WebSocket; the existing harness already does this. A persistent connection
  across multiple gestures is a separate candidate, requiring cancellation,
  disconnect, and stuck-touch tests before adoption.
  [serve-sim maintainer guidance](https://github.com/EvanBacon/serve-sim/blob/main/AGENTS.md).
- Appium's `waitForIdleTimeout`, `animationCoolOffTimeout`, `useFirstMatch`, and
  snapshot-depth controls belong to its XCUITest driver. This harness does not
  use that driver, so tuning those knobs would have no effect.
  [Appium settings](https://appium.github.io/appium-xcuitest-driver/9.10/reference/settings/).

## Native debugging and image review

The first successful iPhone run is
`run-2026-09-11T12-34-41-325Z-7a6a331b`: eight images, nine total captures
including final-state proof, no retries, and 277.8 seconds including session
startup/cleanup. Export produced opaque 1320×2868 sRGB PNGs plus App Store,
Freedom Store and website ZIPs. This is a measured iPhone result, not an Android
runtime prediction. Every image was opened for visual inspection.

The native iterations identified four concrete issues:

1. The older iOS binary lacks the optional Nitro `OutputDataCreator`. Metro
   displays a module-initialization error even when the outer require catches it.
   The loader now checks `hasHybridObject` before importing CDK's eager native
   export. The existing instrumented cashu-ts fallback remains byte-equivalent;
   registered native implementations still require the original full self-test.
2. The revised legal screen no longer requires scrolling to enable consent, and
   the title test ID is absent from iOS AX. Fresh-install and onboarding/reinstall
   scripts now wait for the visible consent controls. Both checkbox confirmations
   and the Terms → Privacy gate remain explicit.
3. Removing per-step PNGs exposed a driver race: the previous page's queued AX
   snapshot could supply coordinates for a retry on the next page. A Privacy
   transition then tapped Back to Terms. Taps and swipes now suspend the stream,
   invalidate its cache and obtain a fresh native snapshot before resuming it.
   Two failing-then-passing regression tests cover the stale-tree behavior.
4. Contacts renders real row IDs, not `screen-contacts`. The store flow now waits
   for a contact row. Current Mock Mode deliberately excludes its two allowlisted
   real contacts from fabricated DM history, so balance split replaces the chat
   image rather than relying on or displaying private messages.

Visual review also found a missing selected-mint header when the default mint
could not initialize, and development source chips on the public profile. The
capture setup now explicitly selects the available macadamia mint and asserts
its selected-mint probe. Mock Mode suppresses internal tier badges. The polished capture
`run-2026-09-11T12-39-38-403Z-f4df8257` passed in **288.9 seconds (4m 49s)**,
with all eight images, nine total PNG captures, no retries and successful final
state. Every final image was visually reviewed; both presentation fixes are
visible. Its exports are the original eight-page baseline.

### Android build and capture validation

No Android development APK or generated native projects existed initially.
The first CocoaPods/Gradle attempts failed with **No space left on device**.
Generated projects from that failed attempt were removed; shared caches and user
data were preserved. A later Android prebuild with
`expo-template-bare-minimum@56.0.35`, `--no-install`, and
`--skip-dependency-update react,react-native` succeeded and left package/config
bytes unchanged. The Android debug build then succeeded in **2m 4s** using JDK 17,
Gradle 9.3.1 and `:app:assembleDebug -PreactNativeArchitectures=arm64-v8a`
with two workers. The 134 MiB APK is at
`app/android/app/build/outputs/apk/debug/app-debug.apk`. The first emulator attempts failed because the host lacked 7,372.8 MiB for
first-boot userdata. A 3 GiB config experiment was ineffective: the emulator
clamps API 24+ first-boot data images to 6 GiB, so that change was removed.
Generated intermediates from this session's builds were removed while the APK
was retained byte-for-byte; existing simulator data and wallet storage were not
touched. The first full Android journey passed in **411.6 seconds (6m 52s)**:
`run-2026-09-11T12-52-18-380Z-6a1d8d31`. Visual review found the QR footer
covered its address row at the original 420 dpi after the 1080×1920 override.
The store lane now pairs that resolution with 320 dpi. Visual inspection of the
new receive image confirms that the complete QR code, address row and Copy button
fit without overlap. The status bar requests fixed demo network indicators; this
Android 16 image still renders duplicated Wi-Fi indicators, a remaining cosmetic
emulator limitation.
The final Android run `run-2026-09-11T13-03-30-689Z-a0d657eb` passed in
**396.0 seconds (6m 36s)**, with no action retries, eight named screenshots,
a successful final-state assertion and automatic emulator shutdown. All eight
images were visually reviewed; this is the original eight-page Android baseline.
[Android SystemUI demo protocol](https://android.googlesource.com/platform/frameworks/base/+/android16-qpr2-release/packages/SystemUI/docs/demo_mode.md).
[Emulator first-boot partition minimum](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp).
Do not run `build:dev:*` casually: those commands also refresh dependencies and
remove native projects.

The browser tool was retried and again failed before navigation because its
runtime could not initialize (`sandboxPolicy` missing). The viewer's HTTP API
serves both the historical eight-image and final fourteen-image manifests. A live ZIP download initially returned
403 because the artifact allowlist omitted archives. It now permits only the
seven generated archive names inside `store/`, sends download/content-type
headers, and rejects arbitrary archives, custody paths and symlinked ancestors.
The live download returns HTTP 200 and is byte-identical to the export. Six
file-serving tests and all 69 viewer tests pass; no rendered browser pass is
claimed.

## Completed verification

- JSON schema, compact formatting and cross-suite references pass.
- Full `bun test ./e2e` from `app/`: 761 pass, 2 historical-artifact tests
  skipped, 0 fail. An earlier concurrent attempt hit ENOSPC in two temporary-file
  tests; the complete rerun after simulator cleanup passed.
- After the download-route fix: all 69 viewer tests pass, with the same two
  historical-artifact skips (includes three new download tests).
- App iOS and Android TypeScript checks pass.
- Expanded mock/profile/DM/default-mint/selector checks: 78 focused app tests pass.
  Mock activation never writes demo data into live stores, the DM toggle leak is
  reproduced then fixed, and mint display balances sum to the wallet total.
- Focused app selector Jest suite: 27 pass. Crypto fallback, recovery benchmark
  and legal agreement Jest suites: 22 pass.
- Viewer browser bundle builds; focused ESLint and whitespace checks pass.
- Fake store run passes and exports no images as native product evidence.
- Source cocod: 53 focused CLI/routes/migration tests, 78 lifecycle/auth/lease tests,
  and two local startup regression tests pass. A read-only query through the new
  adapter matches SQLite's numeric sum for all 54 ready proofs. The initial full
  source scan included two optional adapter-contract suites whose development
  dependency was not installed; the explicitly selected checks above pass.
- Live source daemon reaches `running`; both `cocod balance` and the app's typed
  counterparty adapter return numeric per-mint balances. The original config is
  byte-identical and all 2,287 existing proofs retain their amount and cryptographic
  fields. No payment was initiated for this verification.

Both native screenshot sets and their store exports passed. Rendered-browser
verification remains unavailable because of the browser runtime failure described
above. Tests cover screenshot evidence reduction/failure retention, selection,
platform planning, export completeness, native-only provenance, opaque PNGs, ZIP
output, platform/store separation, tall Android aspect-ratio preservation, and
rejection of fully masked frames. The exporter also enforces store
dimensions; both final native exports passed that gate.
