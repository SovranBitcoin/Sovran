# Dependency surface audit

**September 9, 2026 follow-up:** `@monicon/native` and `patch-package` have
also been removed. `app/assets/icons/generated.json` now feeds the existing
`react-native-svg` renderer directly; Bun applies the five exact-version patches
from root `patchedDependencies`. Across all workspaces this follow-up removes
79 distinct resolved package versions (1,825 → 1,746), with no new versions.
All 212 glyph records and all 27 patched files were verified against the
previous implementation. Bun can accept mismatched removed-line text in a
patch, so successful installation alone does not establish patch correctness;
review exact target versions and resulting files whenever changing patches.
The dated audit below records the earlier dependency graph and decisions.

This is a source and lockfile audit of the app's non-Cashu, non-Nostr,
non-React, and non-Expo dependency candidates. The baseline was captured on
**2026-08-20, before the reductions described here began**. The declared ranges
below come from that `app/package.json`; resolved versions and graph
reachability come from that `bun.lock` / `bun pm why` snapshot. Upstream facts
come from exact npm registry artifacts and the corresponding package source.

Release age, maintainer count, registry signatures, and provenance records are
operational signals only. They are not evidence that a package is vulnerable or
safe.

## Outcome

The low-risk reductions were implemented as follows:

1. **`unique-username-generator` was internalized.** The app now owns only the
   exact deterministic seeded path, protected by named vectors and a 4,096-seed
   corpus digest.
2. **`text-encoding-polyfill` was replaced by
   `@bacons/text-decoder@0.0.0`.** Hermes supplies `TextEncoder`; the much
   smaller package supplies the UTF-8-only `TextDecoder` at the early shim
   boundary. It was already transitive through NDK, so declaring the direct
   import adds no registry artifact.
3. **`@rn-primitives/checkbox` was retained and pinned at `1.5.2`.** A local
   replacement could match the ordinary controlled toggle but not the full
   native and Radix-backed web contract without reimplementing platform
   behavior. That failed the required fidelity threshold.
4. **The direct `process` import/declaration was removed.** React Native and
   Quick Crypto supply the properties used at startup; `process@0.11.10` still
   exists transitively, so this is declaration/code cleanup rather than graph
   elimination.
5. **The direct `react-native-get-random-values` and `expo-crypto` fallbacks
   were removed.** Quick Crypto is now the final global provider and startup
   fails loudly if `crypto.getRandomValues` is absent. RNGRV remains transitive
   through NDK; `expo-crypto` is gone from the lockfile.
6. **The unused `@monicon/metro` root and all 24 direct `@iconify-json/*`
   development roots were removed.** Runtime icons already resolve through the
   committed `.monicon/icons.js` registry, and the registry test now validates
   that artifact directly.
7. **Retained security-sensitive roots were pinned to reviewed resolutions.**
   Quick Crypto is `1.1.7`, Noble is `2.3.0` in app and wallet, the NPC SDK is
   `0.3.2`, and the Android process-restart boundary is `0.0.27`. Future
   changes should be explicit lockfile-review updates.

Measured across `app/package.json`, the app moved from 105 to 100 runtime roots
and from 55 to 31 development roots: **29 fewer direct roots overall**. The
lockfile lost **exactly 28 package-resolution entries**: 24 Iconify collections,
`@monicon/metro`, `expo-crypto`, `text-encoding-polyfill`, and
`unique-username-generator`. No replacement
artifact was added because `@bacons/text-decoder@0.0.0` was already reachable
through NDK. `process` and `react-native-get-random-values` remain transitive
and are deliberately not counted as eliminated artifacts.

`react-native-restart` must be retained. On Android it performs a ProcessPhoenix
process rebirth; Expo reloads only React. BitChat has a process-wide
geohash-to-identity cache keyed without profile scope, so substituting Expo
reload can reuse the previous profile's derived private identity—a cross-profile
key and privacy leak.

Keep `supercluster`, `@noble/hashes`, and `buffer`. Eliminating `npubcash-sdk`
requires both moving the app's NPC behavior behind an owned boundary and
removing that SDK edge from `coco-cashu-plugin-npc` (or replacing the plugin);
either change alone leaves the package reachable.

| Audited package             | Baseline declared -> locked | Latest on audit date | Lock artifacts eliminated | Decision / implemented status                                 |
| --------------------------- | --------------------------- | -------------------- | ------------------------: | ------------------------------------------------------------- |
| `unique-username-generator` | `^1.5.1` -> `1.5.1`         | `1.5.1`              |                         1 | Internalized exact seeded subset; package removed             |
| `text-encoding-polyfill`    | `^0.6.7` -> `0.6.7`         | `0.6.7`              |                         1 | Replaced by already-transitive `@bacons/text-decoder`         |
| `supercluster`              | `^8.0.1` -> `8.0.1`         | `9.0.0`              |                         0 | Retained; assess v9 separately                                |
| `process`                   | `^0.11.10` -> `0.11.10`     | `0.11.10`            |                         0 | Direct shim/import removed; artifact remains transitive       |
| `npubcash-sdk`              | `^0.3.2` -> `0.3.2`         | `0.3.2`              |                         0 | Retained and pinned exactly at `0.3.2`; upstream first        |
| `@rn-primitives/checkbox`   | `^1.2.0` -> `1.5.2`         | `1.5.2`              |                         0 | Retained and pinned; local replacement failed fidelity review |
| `@noble/hashes`             | `^2.0.1` -> `2.3.0`         | `2.3.0`              |                         0 | Retained and pinned exactly at `2.3.0`                        |
| `buffer`                    | `^6.0.3` -> `6.0.3`         | `6.0.3`              |                         0 | Retained                                                      |

“Unique” was computed against the baseline app runtime dependency closure. It
is an install/lockfile-surface result, not a claim about what Metro includes in
a particular native bundle.

## Package findings

### `unique-username-generator`

The baseline app imported one function in `shared/lib/username.ts`; the internal
replacement preserves the same seed, hyphen separator, two custom dictionaries,
and length 64. The current custom dictionaries contain 710 adjective/verb
choices and 118 noun choices, so the visible namespace is at most 83,780 names
(about 16.35 bits). It must not be treated as a secret, account identifier, or
collision-resistant value.

For a seeded call, `1.5.1` hashes `String(seed)` through `xmur3`, takes one
32-bit result as the state of `mulberry32`, and performs two sequential indexed
dictionary selections. The relevant implementation is the upstream
[`random.ts`](https://github.com/subhamg/unique-username-generator/blob/eebb91e51cde2537566a370655ce834ecd6c2624/src/utils/random.ts)
and
[`index.ts`](https://github.com/subhamg/unique-username-generator/blob/eebb91e51cde2537566a370655ce834ecd6c2624/src/index.ts).
No fresh randomness is consumed on Sovran's path.

The generic unseeded API prefers `crypto.getRandomValues`, but modulo-reduces a
32-bit word and falls back to a Date-seeded `xorshift32` if Web Crypto is
missing. The older exported `generateUsername` also uses `Math.random`. None of
those paths are used by Sovran, and none should be copied into the internal
function.

The internal implementation retains the already-filtered app dictionaries and
copies only `xmur3`, `mulberry32`, and the two bounded lookups. Its compatibility
test covers representative Unicode/empty/64-character seeds and a 4,096-seed
corpus digest. Changing the PRNG, number or order of draws, dictionary order,
case formatting, or seed stringification changes existing display names.

Registry facts: `1.5.1` has no runtime dependencies, was published 2025-08-11,
has one listed npm maintainer, is MIT-licensed, and has a 277,085-byte / 17-file
unpacked artifact. Registry metadata exposes a registry signature but no npm
provenance attestation. See the
[`1.5.1` registry record](https://registry.npmjs.org/unique-username-generator/1.5.1)
and [package history](https://registry.npmjs.org/unique-username-generator).

**Decision:** internalized with golden compatibility coverage. If a new random
username feature is ever added, make that a distinct API backed only by the
platform CSPRNG and use unbiased bounded sampling; fail if the CSPRNG is absent.

### `text-encoding-polyfill`

This was a side-effect-only import at the top of baseline `shim.js`. Version
`0.6.7` installs `TextEncoder` / `TextDecoder` only when missing and contains
the old WHATWG reference implementation plus legacy encoding indexes. Its two
main source files are about 631 kB uncompressed combined. It has no runtime
dependencies, but its CommonJS entry loads the index table unless the bundler
honors the package's browser exclusion. See the exact upstream
[`encoding.js`](https://github.com/inexorabletash/text-encoding/blob/4aff951959085f74a5872aeed8d79ec95b6c74c3/lib/encoding.js)
and
[`encoding-indexes.js`](https://github.com/inexorabletash/text-encoding/blob/4aff951959085f74a5872aeed8d79ec95b6c74c3/lib/encoding-indexes.js).

Sovran's runtime calls use only the default encoding or explicit `utf-8`.
Hermes has a native `TextEncoder` implementation, including
[`encode`](https://github.com/facebook/hermes/commit/36d0e126566de36a1d9042aab12cdecd79671fe7)
and
[`encodeInto`](https://github.com/facebook/hermes/commit/d3b34bb26c3ce102d0a709d82b9bcdb192299252).
Expo SDK 56's native WinterCG bootstrap imports React Native initialization and
installs its UTF-8 `TextDecoder` when necessary; see
[`runtime.native.ts`](https://github.com/expo/expo/blob/39f9dc47fb5ddd099a2533dd0ff24be7126a1ed0/packages/expo/src/winter/runtime.native.ts).
Browsers already supply both globals.

That Expo installation is too late to be the app's only guarantee:
`app/index.js` intentionally runs `shim.js` before `expo-router/entry` and before
the application/dependency graph. The implemented replacement therefore imports
`@bacons/text-decoder/install` at the first line of `shim.js`, then fails startup
if either global is still absent. The package installs only a UTF-8 decoder and
leaves Hermes's encoder intact. Its edge tests cover astral Unicode, split
multibyte streaming, malformed-byte replacement, `fatal: true`, and BOM /
`ignoreBOM` behavior.

`@bacons/text-decoder@0.0.0` was already present through
`@nostr-dev-kit/ndk-mobile@0.2.2`, so making the early import a declared direct
dependency added no artifact. It has no runtime dependencies, peers on React
Native, was published 2024-05-08, lists one npm maintainer, is MIT-licensed,
and is a 17,979-byte / 13-file artifact. Registry metadata exposes a registry
signature but no npm provenance attestation. Its package metadata points to a
repository that is not currently publicly readable, so the published tarball
is the verifiable source for this exact version. See the
[`0.0.0` registry record](https://registry.npmjs.org/%40bacons%2Ftext-decoder/0.0.0)
and [package history](https://registry.npmjs.org/%40bacons%2Ftext-decoder).

Registry facts: `0.6.7` was published 2017-06-09, is still latest, lists one npm
maintainer, is Unlicense-licensed, and has no runtime dependencies. The
repository is archived. Registry metadata exposes a registry signature but no
npm provenance attestation. See the
[`0.6.7` registry record](https://registry.npmjs.org/text-encoding-polyfill/0.6.7),
[package history](https://registry.npmjs.org/text-encoding-polyfill), and
[upstream repository](https://github.com/inexorabletash/text-encoding).

**Decision:** replace `text-encoding-polyfill` with the already-transitive,
UTF-8-only `@bacons/text-decoder`, retain the early fail-loud global check, and
do not write an internal codec.

### `supercluster`

`shared/lib/map/mapClustering.ts` uses the substantive API: index construction,
`load`, bounding-box/zoom `getClusters`, and `getClusterExpansionZoom`.
`btcMapClusterCache.ts` caches indexes for datasets documented in the app as
roughly 5,000-40,000 points. Reimplementing this faithfully means owning the
geospatial clustering algorithm and its spatial index, not replacing a trivial
helper.

Locked `8.0.1` declares `kdbush ^4.0.2`, resolved to `4.1.0`. It was published
2023-04-27, is ISC-licensed, and its npm artifact is 57,707 bytes / 6 files. The
registry lists Mapbox team/service maintainers and Vladimir Agafonkin. The
artifact has a registry signature and no npm provenance attestation. See the
[`8.0.1` registry record](https://registry.npmjs.org/supercluster/8.0.1),
[package history](https://registry.npmjs.org/supercluster), and
[`v8.0.1` source](https://github.com/mapbox/supercluster/tree/v8.0.1).

Version `9.0.0` was released 2026-08-10. Its official release notes report lower
allocation/heap use and faster indexing on the project's one-million-point
sample, plus higher coordinate precision, MultiPoint support, and a breaking
`maxZoom <= 30` cap. Sovran uses `maxZoom: 16`, but an upgrade still deserves
map fixture, expansion-zoom, memory, and performance tests. See the
[`v9.0.0` release](https://github.com/mapbox/supercluster/releases/tag/v9.0.0).

**Recommendation:** retain. Evaluate v9 as a measured upgrade, not as part of
dependency deletion.

### `process`

The baseline `shim.js` used the package only to create or fill
`global.process`, then forced `process.browser = false` and `NODE_ENV`. The
package is not Node's process implementation: its browser export provides a
timer-backed `nextTick`, empty `env` / `argv` / version fields, no-op event
methods, `cwd() === '/'`, and throwing `chdir` / `binding`. See
[`browser.js` at v0.11.10](https://github.com/defunctzombie/node-process/blob/v0.11.10/browser.js).

React Native `0.85.3` already initializes `global.process`, `process.env`, and
`NODE_ENV` in
[`setUpGlobals.js`](https://github.com/facebook/react-native/blob/22ea81b5e37b0cf23be1d8fb32bb7f55e1fcf3d8/packages/react-native/Libraries/Core/setUpGlobals.js).
Quick Crypto also installs `process.nextTick` when absent. Sovran's app-runtime
source reads compile-time Expo environment values; it does not use the browser
shim's event/cwd/binding surface.

The implemented shim no longer imports or copies this package, and it no longer
assigns `process.browser`. It keeps only the app-owned `process.env ??= {}` and
`NODE_ENV` assignments. Removing the direct root did not remove the artifact:
`process@0.11.10` is also required by `readable-stream@4.7.0`, reached through
`react-native-quick-crypto@1.1.7` (and currently the image-colour web dependency
tree). It is therefore a code simplification and declaration cleanup, not an
immediate supply-chain reduction.

The bootstrap regression runs in Jest's Node environment, where a real
`process` already exists. It proves that this harness no longer needs the npm
browser shim, that `process.env` / `NODE_ENV` survive setup, and that Quick
Crypto leaves a callable `nextTick`; it does not by itself prove the native
cold-boot branch. On device, React Native's pre-bundle global setup normally
creates `process`, and Quick Crypto defensively creates a minimal object plus
`nextTick` if it is absent. Native iOS and Android cold starts remain the
ordering check for that runtime contract.

Registry facts: `0.11.10` was published 2017-04-26 and is still latest, has no
runtime dependencies, lists three npm maintainers, and is MIT-licensed. Registry
metadata exposes a registry signature but no npm provenance attestation. See
the [`0.11.10` registry record](https://registry.npmjs.org/process/0.11.10) and
[package history](https://registry.npmjs.org/process).

**Decision:** direct `require` and declaration removed; no `process.browser`
compatibility assignment remains. Keep the focused Jest contract and a native
cold-start gate rather than introducing a local imitation of the whole process
API.

### `npubcash-sdk`

This is real application and protocol behavior, not a helper. Sovran constructs
`JWTAuthProvider` and `NPCClient`, handles `PaymentRequiredError`, requests and
subscribes to quotes, and calls `settings.setLock`. The SDK performs NIP-98 to
short-lived-JWT authentication, authenticated HTTP, WebSocket challenge/response,
payment-request parsing, and settings updates. Its ESM bundle imports
`nostr-tools/nip98` and expects platform `fetch`, `WebSocket`, `TextEncoder`,
`TextDecoder`, and either `Buffer` or browser base64 globals.

The package declares `@cashu/cashu-ts ^3.2.2`, `nostr-tools ^2.19.4`, and
`npubcash-types ^0.1.1`. In this lockfile those resolve to the already-present
`@cashu/cashu-ts@5.0.0-rc.4` (by the workspace override),
`nostr-tools@2.24.2`, and the otherwise-new `npubcash-types@0.1.1`.

More importantly, `coco-cashu-plugin-npc@3.0.0` independently imports
`npubcash-sdk@0.3.2` and constructs the same client/auth provider. Deleting
Sovran's direct imports or declaration without changing the plugin therefore
removes no package and would either break the app or rely on an undeclared
transitive dependency.

Registry facts: `0.3.2` was published 2026-01-08, is latest, lists one npm
maintainer, and is a 52,539-byte / 5-file artifact. Its published package
metadata contains no `repository`, `gitHead`, or `license`; the included README
says MIT. Registry metadata exposes a registry signature but no npm provenance
attestation. A repository under the maintainer's GitHub handle currently has a
private `0.0.0` package manifest and older dependency set, and has no tag that
connects it to the published `0.3.2` artifact. These are source-verifiability
facts, not a vulnerability claim. See the
[`0.3.2` registry record](https://registry.npmjs.org/npubcash-sdk/0.3.2),
[package history](https://registry.npmjs.org/npubcash-sdk), and the repository's
current [`package.json`](https://github.com/Egge21M/npubcash-sdk/blob/main/package.json).

**Recommendation:** retain the declared dependency while either current edge
exists. Actual graph elimination needs both parts in one protocol-tested
change: (1) move client construction, settings calls, paid-claim behavior, and
`PaymentRequiredError` mapping behind an app-owned NPC interface that does not
expose or import SDK types; and (2) remove/replace
`coco-cashu-plugin-npc`, or upstream it so the plugin itself no longer imports
the SDK. Completing only one part leaves `npubcash-sdk` reachable. Do not
casually internalize auth/payment/WebSocket code.

### `@rn-primitives/checkbox`

There is one production package consumer:
`shared/ui/primitives/SelectableCheck/SelectableCheck.square.tsx`. It reports
the controlled boolean, ignores activation while disabled, calls the change
callback with the inverse controlled value, exposes the checkbox
role/checked/disabled/label/hint contract, and conditionally displays the icon.
The app does not currently use `asChild`, `forceMount`, indeterminate state, or
the primitive outside this visual component.

On native, the upstream implementation is a context plus `Pressable`: it sets
checkbox accessibility state, ignores presses while disabled, calls
`onCheckedChange(!checked)`, forwards `onPress`, and mounts the indicator only
when checked. On web it additionally delegates keyboard/form behavior to Radix
and maintains `data-state`, `data-disabled`, `type`, role, and value. See the
matching upstream tag's
[`checkbox.tsx`](https://github.com/roninoss/rn-primitives/blob/7932ab8fe75fbf6f5729288b6a625e7ca50ead69/packages/checkbox/src/checkbox.tsx)
and
[`checkbox.web.tsx`](https://github.com/roninoss/rn-primitives/blob/7932ab8fe75fbf6f5729288b6a625e7ca50ead69/packages/checkbox/src/checkbox.web.tsx).

`1.5.2` declares `@radix-ui/react-checkbox ^1.3.3` (resolved `1.3.11`) and exact
`1.5.2` versions of `@rn-primitives/hooks`, `slot`, and `types`. Against the
baseline graph, deleting this root would remove six unique runtime artifacts:
`@rn-primitives/{checkbox,hooks,slot,types}`, `@radix-ui/react-checkbox`, and
`@radix-ui/react-use-size`. Other Radix support packages are shared elsewhere.

Registry facts: `1.5.2` was published 2026-07-02, is latest, lists three npm
maintainers, is MIT-licensed, and is 20,373 bytes / 14 files. The registry
package metadata contains no repository link. It exposes a registry signature
but no npm provenance attestation. See the
[`1.5.2` registry record](https://registry.npmjs.org/%40rn-primitives%2Fcheckbox/1.5.2),
[package history](https://registry.npmjs.org/%40rn-primitives%2Fcheckbox), and
the matching [`all@1.5.2` source tag](https://github.com/roninoss/rn-primitives/tree/all%401.5.2/packages/checkbox).

**Decision:** retain and exact-pin `1.5.2`. The attempted local implementation
matched the ordinary controlled inverse-callback, disabled, accessibility, and
indicator behavior, but Sovran's shared `Pressable` has a single-flight guard
that changes rapid activation. A concise replacement also lost the upstream
web implementation's Radix form, keyboard, focus, and `data-state` semantics.
Owning all of that behavior would not be a simple faithful shim, so the
six-artifact subtree remains.

### `@noble/hashes`

This package is used extensively, directly and transitively: SHA-256, HMAC,
HKDF, PBKDF2, byte/hex/UTF-8 conversion, and random bytes appear across wallet,
Nostr signer, Blossom, BitChat, Whitenoise, and vendored Marmot code. It is also
required through Noble Curves, Scure, and Cashu dependencies, so deleting the
direct root would not delete the artifact.

Version `2.3.0` has no runtime dependencies. Its `randomBytes` validates the
requested length, requires `globalThis.crypto.getRandomValues`, enforces the
65,536-byte Web Crypto limit, and throws when a provider is missing. It has no
`Math.random` or other fallback. See the exact
[`randomBytes` source](https://github.com/paulmillr/noble-hashes/blob/2.3.0/src/utils.ts#L898-L926).

Registry facts: `2.3.0` was published 2026-08-06, is latest, lists one npm
maintainer, is MIT-licensed, and is 680,759 bytes / 60 files before tree
shaking. It is the only one of the eight audited artifacts whose npm metadata
exposes a provenance attestation; it also has a registry signature. The
project's security notes record a full self-audit at `2.2.0` in April 2026 and
an independent Cure53 audit at `1.0.0` in January 2022 with named exclusions.
`2.3.0` is newer than the self-audited version, so those audit scopes should not
be described as a blanket audit of the exact installed artifact. See the
[`2.3.0` registry record](https://registry.npmjs.org/%40noble%2Fhashes/2.3.0),
[npm attestation](https://registry.npmjs.org/-/npm/v1/attestations/@noble%2fhashes@2.3.0),
and upstream [security section](https://github.com/paulmillr/noble-hashes/blob/2.3.0/README.md#security).

**Recommendation:** retain. Never replace cryptographic primitives with local
implementations for dependency-count reasons.

### `buffer`

Sovran directly imports `Buffer` in NFC APDU/NDEF code for UTF-8, UTF-16LE, hex,
and base64 conversions. Quick Crypto's installer exposes its React Native
Buffer implementation globally; the redundant `require('buffer')` startup
fallback was removed with the process cleanup. Multiple third parties also
depend on `buffer@6.0.3`, including Gandalf UR/BOLT11 packages, Cashu crypto,
and `readable-stream`. Removing the direct declaration therefore removes no
artifact and would leave direct imports undeclared.

This package implements a broad Node-compatible Buffer surface over
`Uint8Array`, not merely two encoding functions. Its exact source is
[`index.js` at v6.0.3](https://github.com/feross/buffer/blob/v6.0.3/index.js).
Reimplementing enough methods for current local calls would not cover
third-party/global expectations.

Registry facts: `6.0.3` was published 2020-11-23 and is still latest, declares
`base64-js ^1.3.1` and `ieee754 ^1.2.1` (resolved `1.5.1` and `1.2.1`), lists one
npm maintainer, is MIT-licensed, and is 91,279 bytes / 6 files. Registry
metadata exposes a registry signature but no npm provenance attestation. See
the [`6.0.3` registry record](https://registry.npmjs.org/buffer/6.0.3) and
[package history](https://registry.npmjs.org/buffer).

**Recommendation:** retain. Local byte helpers may improve domain readability,
but they do not materially reduce this dependency surface.

## Additional candidates

### Retain `react-native-restart`

Sovran calls only `RNRestart.restart()` from `shared/lib/profile/appRestart.ts`.
Pinned `0.0.27` was published 2023-01-31, has one listed npm maintainer, no npm
runtime dependencies, a registry signature, and no provenance attestation. Its
npm artifact is 599,401 bytes / 83 files and its Android Gradle file additionally
pulls `com.jakewharton:process-phoenix:2.1.2`. Version `0.0.29` is current as of
2026-08-15 and has npm provenance, but upgrading would not remove the package.
See the
[`0.0.27` registry record](https://registry.npmjs.org/react-native-restart/0.0.27),
[package history](https://registry.npmjs.org/react-native-restart), and pinned
[`RestartModule.java`](https://github.com/avishayil/react-native-restart/blob/d88d5de3c3b8aedfb6735c1b327064d717abd162/android/src/main/java/com/reactnativerestart/RestartModule.java).

Expo Modules Core does export `reloadAppAsync`, documented in source as working
in release and debug builds while reloading the same JavaScript bundle. Its iOS
implementation triggers React reload listeners; Android calls the activity's
React delegate reload. See exact SDK 56
[`reload.ts`](https://github.com/expo/expo/blob/39f9dc47fb5ddd099a2533dd0ff24be7126a1ed0/packages/expo-modules-core/src/reload.ts),
[iOS implementation](https://github.com/expo/expo/blob/39f9dc47fb5ddd099a2533dd0ff24be7126a1ed0/packages/expo-modules-core/ios/Core/AppContext.swift),
and
[Android implementation](https://github.com/expo/expo/blob/39f9dc47fb5ddd099a2533dd0ff24be7126a1ed0/packages/expo-modules-core/android/src/main/java/expo/modules/kotlin/defaultmodules/CoreModule.kt).

The iOS mechanisms are near-equivalent: pinned `react-native-restart` and Expo
both call `RCTTriggerReloadCommandListeners`; they differ mainly in reason and
main-thread dispatch details. See the pinned package's
[`Restart.m`](https://github.com/avishayil/react-native-restart/blob/d88d5de3c3b8aedfb6735c1b327064d717abd162/ios/Restart.m).
That does not make Expo a faithful cross-platform replacement. On Android,
pinned `react-native-restart` calls `ProcessPhoenix.triggerRebirth`, destroying
process-wide native state. Expo reloads only the React delegate; moreover, its
Android async function returns early when the activity is not a
`ReactActivity` or has no delegate, so the JavaScript promise can resolve
without having requested any reload.

That Android difference is security-relevant. BitChat's vendored
`NostrIdentityBridge` is a Kotlin `object` with a process-wide
`geohashIdentityCache` keyed only by geohash. `deriveIdentity` returns that
cached private identity before reading the active profile's scoped device seed.
`BitChatNostrBridge.start(profileScope)` swaps the scoped storage context, but
its `stop()` does not clear the vendor cache.

Replacing the production process rebirth with an Expo React reload would
therefore let profile B, on a geohash previously visited by profile A, reuse A's
derived Nostr private identity. That is both a cross-profile key leak and an
identity-linkability privacy failure. The current development path already
uses `DevSettings.reload()`, which is also only a React reload, so Android dev
profile switches carry this known cache risk even though release switches use
ProcessPhoenix. The `expo-updates` fallback after an RNRestart exception also
cannot be treated as a proven successful profile isolation boundary.

**Decision:** retain `react-native-restart`. Reconsider only after every
profile-sensitive native singleton has an explicit, tested teardown—including
the BitChat geohash identity cache—and release Android tests prove key separation
across same-geohash profile switches. Separately, make the Android development
path process-restarting or explicitly clear/test the cache; iOS's
near-equivalence is not the reason to keep this dependency.

### Removed unused Monicon and Iconify build roots

The app still uses `@monicon/native`, but it did not use
`@monicon/metro@2.0.8`. `metro.config.js` already resolves
`@monicon/runtime` directly to the committed `.monicon/icons.js` file and
explicitly documents that this path replaces the incompatible
`withMonicon()` wrapper. Removing the direct Metro adapter consequently removes
one lock artifact without changing runtime icon resolution. See its exact
[`2.0.8` registry record](https://registry.npmjs.org/%40monicon%2Fmetro/2.0.8).

The 24 direct `@iconify-json/*` development packages were also disconnected
from the actual generation path. `scripts/regenerate-icons.js` reads the
app-owned icon list and fetches only those names from the official
[Iconify API](https://iconify.design/docs/api/); runtime reads the committed
registry. The icon test now derives its allowed prefixes from the registered
names and committed output rather than from installed collection packages.
Removing those 24 roots removes 24 corresponding lock entries while preserving
the generated-glyph coverage test. `@iconify-json/simple-icons` remains
transitive through the docs toolchain and is not one of these removed app
roots.

**Decision:** keep the owned generation/committed-registry boundary and
`@monicon/native`; keep `@monicon/metro` and the 24 app-level Iconify collection
roots removed.

### Investigate `react-native-image-colors`, but do not hand-roll it

The package is genuinely used for wallpaper-driven theming and contains native
palette extraction on both platforms. On web it imports
`node-vibrant/browser`, but `node-vibrant` is declared as an unconditional
runtime dependency and also installs its Node/Jimp adapters. In the current
lock graph, `react-native-image-colors@2.6.0` reaches 64 runtime artifacts, 52 of
which are not reached from any other app dependency. Those 52 affect install
and lockfile surface even though Metro's native platform resolution should not
bundle the web/Node implementation.

Version `2.6.0` is latest, was published 2026-03-11, is MIT-licensed, lists one
npm maintainer, directly depends on `node-vibrant ^4.0.3` (resolved `4.0.4`),
and has a registry signature but no npm provenance attestation. See the
[`2.6.0` registry record](https://registry.npmjs.org/react-native-image-colors/2.6.0),
[package history](https://registry.npmjs.org/react-native-image-colors), and its
platform-specific
[`module.web.ts`](https://github.com/osamaqarem/react-native-image-colors/blob/5cd45d332e89d29f36f016d2fb73b5062274ccfb/src/module.web.ts).

The opportunity is an upstream/forked packaging split: make the web palette
engine independently installable, or deliberately fall back to a fixed theme
on web. Copying iOS `UIImageColors`, AndroidX Palette behavior, SVG handling,
network loading, cache semantics, and web Vibrant quantization into a “small”
TypeScript function would not be faithful.

### Secondary scan results

- `tailwind-merge` and `tailwind-variants` have few direct import sites, but
  `heroui-native@1.0.4` peer-depends on them and its compiled styles use them.
  They are not standalone dead dependencies.
- The direct `react-native-get-random-values` declaration/import was removable
  only because Quick Crypto is installed as the final global provider before
  application consumers and the shim now throws if that installation does not
  expose `getRandomValues`. RNGRV remains in the lockfile through NDK but is no
  longer the app's entropy authority.
- The direct `expo-crypto` dependency and conditional global fallback were
  removed. Silently substituting a second provider obscured which entropy
  boundary was active; the bootstrap now has one provider and fails closed.
- The current `knip` pass reports no unignored unused direct dependency. Its
  dependency-ignore list is now exactly `buffer`, `expo-screen-corner-radius`,
  `patch-package`, `react-native-fast-squircle`, and `@noble/curves`.
  `process`, `@monicon/metro`, and the `@iconify-json/*` pattern are no longer
  ignored, so their removal is visible to the static check rather than hidden
  by configuration.

## Entropy invariants

Dependency reduction must preserve these invariants:

1. `app/index.js` imports only `shim.js` before application modules. The shim
   calls Quick Crypto's `install`, verifies `getRandomValues` is callable with
   an actual **one-byte `Uint8Array` probe**, and separately requires
   `crypto.subtle`. Startup stops if either the native random provider cannot
   serve the probe or SubtleCrypto is absent; there is no entropy fallback.
   The one-byte call is a provider-availability probe, not the amount of
   entropy used by downstream operations and not a statistical randomness
   test.
2. Quick Crypto is the final global entropy provider and is pinned exactly at
   `react-native-quick-crypto@1.1.7`. Its installer assigns the package's crypto
   object globally; its `getRandomValues` and `randomUUID` paths use native
   `randomFillSync`. See the exact
   [`install`](https://github.com/margelo/react-native-quick-crypto/blob/v1.1.7/packages/react-native-quick-crypto/src/index.ts)
   and
   [`random`](https://github.com/margelo/react-native-quick-crypto/blob/v1.1.7/packages/react-native-quick-crypto/src/random.ts)
   source and the
   [`1.1.7` registry record](https://registry.npmjs.org/react-native-quick-crypto/1.1.7).
3. The direct
   `react-native-get-random-values` bootstrap and the conditional `expo-crypto`
   assignment were removed. RNGRV remains transitive through NDK, but its
   legacy Chrome-debugger `Math.random` fallback is not the app's provider and
   must never become one.
4. Both the app and wallet pin `@noble/hashes` exactly at `2.3.0`. Its
   `randomBytes` calls only
   `globalThis.crypto.getRandomValues` and fail closed when it is absent. Keep
   that behavior; never add `Math.random`, timestamps, deterministic seeds, or
   silent fallback for keys, nonces, salts, tokens, proof secrets, or wallet
   seeds.
5. Fresh mnemonic creation requests one 16-byte `Uint8Array` from
   `crypto.getRandomValues`, providing 128 bits of entropy before BIP-39
   encoding. Its lifecycle test verifies that no mnemonic is persisted when the
   provider is missing.
6. NIP-46's default mint-RPC request ID now uses the final provider's
   CSPRNG-backed `crypto.randomUUID()` rather than a roughly 32-bit
   `Math.random` value. The test verifies that pairing calls `randomUUID` once
   and uses its result; provider failure returns a typed error before connection
   state is mutated.
7. Each randomized NIP-17/NIP-59 seal and wrap timestamp now takes one
   `Uint32Array(1)` CSPRNG draw and maps it into the preceding two-day window.
   This is metadata obfuscation rather than key material, but it must not fall
   back to predictable `Math.random` timestamps.
8. The map safety offset requests one `Uint32Array(2)` CSPRNG draw. One word
   selects the bearing and one selects a distance in the 750-1,800 metre range;
   the spherical destination-point calculation applies that bearing and
   distance geodesically, normalizes longitude, and caches the result for the
   session. If the provider is absent it throws rather than falling back to
   `Math.random` or returning the exact location.
9. NIP-46 bunker secrets take 16 CSPRNG bytes, map provider failure to a typed
   `csprng-failed` result, and persist nothing when generation fails.
10. NUT-18 standing payment-request IDs now take 16 Noble random bytes and hex
    encode all of them after the `sov` prefix: 128 bits of CSPRNG input. The
    regression test verifies the 16-byte request and that operation creation
    fails before any write when the provider is absent.
11. Seeded usernames are deterministic labels. They consume no entropy and must
    remain explicitly outside the security-identifier boundary.
12. The bootstrap regression test mocks the Quick Crypto installation and
    verifies both that its provider remains the final global and that startup
    fails when the CSPRNG is missing or throws, and when `crypto.subtle` is
    missing. Provider tests are wiring smoke tests, not statistical proof of
    cryptographic quality; assurance comes from the pinned native provider
    boundary.
13. Any future bounded random selection must use rejection sampling rather than
    `% range` when bias matters.

The installed `react-native-get-random-values@1.11.0` source contains a
`Math.random` fallback specifically for legacy Chrome remote debugging. The
app no longer imports it directly, the final provider is Quick Crypto, and the
shim asserts that provider after installation rather than relying on debugger
or runtime assumptions. See the exact upstream
[`index.js`](https://github.com/LinusU/react-native-get-random-values/blob/v1.11.0/index.js).

### Remaining `Math.random` classification

The production JavaScript census after these changes has three first-party
uses; none is key, nonce, seed, proof, payment ID, or location entropy. The
native/vendor review also identified two collision-sensitive Android uses worth
fixing; these are not an exhaustive inventory of non-security PRNG use:

- Poll option keys combine a module sequence with a random suffix, and the
  notification-followers handoff cache combines a timestamp with a random
  suffix. Both are ephemeral local identity/lookup concerns and should be made
  deterministic (a monotonic module counter is sufficient) in a focused
  cleanup. The Primal health subscription already moved to the deterministic
  ID `health`.
- NearPay's “random peer” action uses `Math.random` only to choose a visible UI
  target. It has no security or persistence role, so retaining it is
  appropriate.
- The vendored Android `NostrRelayManager` still creates a network subscription
  ID from the current millisecond plus `Math.random() * 1000`. This is not
  secret entropy, but concurrent same-millisecond calls can collide; replace it
  with `UUID.randomUUID()` or a collision-free counter in an upstream/vendor
  correctness change.
- The vendored Android fragment reassembly ID uses
  `kotlin.random.Random.nextBytes`. It is not encryption-key entropy, but a
  collision can mix fragment sets; preserve the eight-byte wire format while
  moving generation to `SecureRandom` in a separately tested vendor change.

Test fixtures with `Math.random` are outside the shipped entropy boundary.

## Implementation state and remaining order

The implemented reductions preserve one concern per boundary and make the graph
effect explicit:

1. Username compatibility vectors were frozen before the seeded implementation
   was internalized and `unique-username-generator` removed.
2. `text-encoding-polyfill` was replaced at the early bootstrap boundary by the
   already-transitive `@bacons/text-decoder`; UTF-8 edge behavior and fail-loud
   global availability are covered.
3. The square checkbox replacement was rejected after focused fidelity review:
   the shared Pressable changes rapid activation and a concise web replacement
   omits Radix form/keyboard/focus semantics. The package remains exact-pinned.
4. Quick Crypto `1.1.7` was pinned as the single final global crypto provider,
   with a one-byte native-provider probe and a separate SubtleCrypto assertion.
   Direct RNGRV and `expo-crypto` plumbing was removed only after fail-closed
   bootstrap coverage was in place; Noble `2.3.0` is also pinned exactly in app
   and wallet.
5. The process shim was reduced to `env`/`NODE_ENV`, its direct declaration was
   removed, and no `process.browser` assignment remains. The transitive
   artifact and the Jest-versus-native cold-boot distinction are recorded.
6. Location privacy moved from `Math.random` to a session-stable two-word
   CSPRNG draw and geodesic offset. Fresh mnemonic generation, NIP-46 RPC IDs,
   randomized NIP-17 timestamps, and 128-bit NUT-18 request IDs now have focused
   CSPRNG/fail-closed coverage.
7. The unused `@monicon/metro` root and 24 direct Iconify collection roots were
   removed behind the already-owned committed icon registry and its coverage
   test.
8. The retained NPC SDK and Android restart boundary were pinned exactly at
   their reviewed lock resolutions, alongside Quick Crypto and Noble.

The measured result is 29 fewer app manifest roots and exactly 28 fewer
lockfile package artifacts, without claiming that the still-transitive
`process` or RNGRV artifacts were eliminated.

The remaining work order is:

1. **Retain `react-native-restart`.** Do not promote Expo/DevSettings reload to
   the Android profile-switch boundary until BitChat and every other
   profile-sensitive native singleton expose and test complete teardown. Fix
   the Android development path separately, because `DevSettings.reload()`
   leaves the process-wide identity cache alive.
2. Run native iOS/Android cold-start checks for the early text/crypto/process
   ordering and release Android same-geohash profile-switch isolation. A
   resolving Expo Android reload promise is not sufficient evidence that a
   reload occurred.
3. Eliminate NPC only when app behavior is behind a non-SDK-owned boundary and
   the plugin SDK edge is also removed; treat image-colour dependency splitting
   as separate upstream architecture work.
4. Replace the poll/cache `Math.random` identifiers deterministically and fix
   the vendored Android subscription-ID collision risk. NearPay's UI-only
   random choice needs no cryptographic replacement.
5. Evaluate `supercluster` v9 separately with map correctness, memory, and
   performance fixtures; do not couple it to this deletion pass.

## Bundle-reachability pass — 2026-08-23

The 2026-08-20 audit above scoped itself to "non-Cashu, non-Nostr, non-React,
non-Expo" candidates. This pass covers the surface that scope excluded, and it
measures a different axis: not how many artifacts the lockfile installs, but how
much of them Metro actually reaches from `app/index.js`. `knip` reports no
unused direct dependency in either state, so nothing here was findable as dead
code.

### NDK's Cashu wallet stack was in every shipped bundle

`@nostr-dev-kit/ndk-mobile@0.2.2` declares `@nostr-dev-kit/ndk-wallet@0.3.16` as
a runtime dependency, and its `dist/module/index.js` re-exports
`./hooks/index.js`, which re-exports `./hooks/session.js`, whose line 6 is a
static `import { walletFromLoadingString } from '@nostr-dev-kit/ndk-wallet'`.
That is the only value import of `ndk-wallet` anywhere in the package —
`providers/session/wallet.js` is commented out in full upstream — but a static
import inside a barrel is unconditional, so all 32 Sovran files importing
`@nostr-dev-kit/ndk-mobile` dragged it in.

`ndk-wallet` is a complete second Cashu wallet: `NDKCashuWallet`, `NDKNWCWallet`,
`NDKNutzapMonitor`, plus `light-bolt11-decoder`, `webln`, `tseep`, `debug`, and
the `@cashu/crypto` peer — which is a *different* Cashu crypto implementation
from `@cashu/cashu-ts`, carrying its own `@noble/hashes@1.8.0` and
`@scure/bip39@1.6.0` beside the exactly-pinned `2.3.0` this app standardizes on.
Sovran's wallet is coco + cashu-ts + colada. It uses none of it: every symbol the
app imports from `ndk-mobile` is either core NDK (`NDKEvent`, `NDKUser`,
`NDKRelay`, `NDKRelaySet`, `NDKPrivateKeySigner`, `NDKPool`, `NDKSubscription`,
`NDKFilter`, `NDKKind`, `NDKAuthPolicy`, `NDKRelayStatus`, `NostrEvent`,
`normalizeRelayUrl`, default `NDK`) or one of three mobile-only exports
(`NDKCacheAdapterSqlite`, `useNDK`, `useSubscribe`). `useNDKSession`,
`useNDKWallet`, `useFollows`, `useMuteList`, `useWOT`, `useSessionEvents`, and
`useNDKSessionEvent(s|Kind)` have zero references in the repo.

`metro.config.js` resolves `@nostr-dev-kit/ndk-wallet` to `{ type: 'empty' }`,
in the same `resolveRequest` chain that already pins `@monicon/runtime` and
`heroui-native`. Measured with `expo export --platform ios --no-minify`, same
machine, back to back:

| iOS Hermes bundle | Bytes        |
| ----------------- | -----------: |
| Before            | 20,318,664   |
| After             | 20,177,167   |
| **Removed**       | **141,497 (0.70%)** |

`strings` over the two `.hbc` files confirms the mechanism rather than inferring
it: `NDKCashuWallet`, `NDKNWCWallet`, and `nutzap-monitor` each appear once in
the before bundle and zero times in the after bundle.

#### Why a resolver stub and not a patch

A `patch-package` patch on `ndk-mobile`'s hooks barrel — dropping the
`./session.js` and `./wallet.js` re-exports outright — was built and measured
first. It removes 148,697 bytes, 7,200 more than the stub, because the ~300
lines of `hooks/session.js`, `hooks/wallet.js`, `stores/session/*` and
`stores/wallet.js` stop being bundled too rather than being bundled around an
empty import. It was rejected anyway: it requires pinning `^0.2.2` to `0.2.2`,
regenerating the patch on every bump, and maintaining a sixth entry in
`app/patches`. 7 KB is not worth standing maintenance on a third-party build
artifact. The stub is four lines, survives `ndk-mobile` upgrades untouched, and
needs no exact pin.

#### Why not simply remove the package

Two exits were checked and both are closed:

- **Upgrade.** The app is on `ndk-mobile@0.2.2`; latest is `0.8.43`. That version
  *still* depends on `@nostr-dev-kit/ndk-wallet` (`0.7.1`) and adds
  `@nostr-dev-kit/ndk-hooks@1.3.4`, which depends on `ndk-wallet@0.7.0` — a
  second copy. It also pins `expo-secure-store ~14.0.1` and `expo-image ~2.0.7`
  and peer-depends `expo ^53`, against this app's SDK 56. Upgrading makes the
  dependency surface strictly worse. `@nostr-dev-kit/ndk-cache-sqlite@3.0.0` is
  not a substitute either — it is built on `better-sqlite3`, a Node binding.
- **Drop `ndk-mobile`, depend on `@nostr-dev-kit/ndk` directly.** Viable in
  principle: only three of the sixteen imported symbols are not core NDK. But
  owning them means vendoring ~750 lines — `stores/ndk.js` (121),
  `hooks/ndk.js` (18), `hooks/subscribe.js` (242), and
  `cache-adapter/sqlite.js` (305) plus `migrations.js` (62). The cache adapter
  owns a SQLite schema and migration path on live user devices, which makes this
  a planned piece of work with `sovran-data` review, not the tail of a cleanup
  pass. Adding 750 lines of vendored third-party code to delete one root also
  has to clear the AHA gate on its own merits.

So this is a bundle-reachability result, not a lockfile result. `ndk-wallet`,
`@cashu/crypto@0.3.4`, `@noble/hashes@1.8.0`, and `@scure/bip39@1.6.0` are still
installed; they are simply no longer reachable from the app entry.

`__tests__/ndkMobileBundleSurface.test.ts` guards the stub from three
directions: `metro.config.js` still carries the `{ type: 'empty' }` resolution;
no app source references any hook that depends on it (the tripwire — a future
caller of `useNDKSession` fails here with the reason instead of at runtime with
"walletFromLoadingString is not a function"); and `ndk-mobile` is still supplying
`useNDK` / `useSubscribe` / `NDKCacheAdapterSqlite`, so the stub cannot be
"fixed" by quietly dropping the surface that justifies the package.

### Duplicate resolutions collapsed

Two direct declarations were each resolving to a version nothing else wanted,
so the lockfile carried a second copy of the package:

| Declaration                     | Was        | Now      | Duplicate removed          |
| ------------------------------- | ---------- | -------- | -------------------------- |
| `wallet` devDep `react`         | `19.2.0`   | `19.2.3` | `react@19.2.0`             |
| `app` devDep `tailwindcss`      | `^4.1.17`  | `4.3.2`  | `tailwindcss@4.3.3`        |

`uniwind@1.11.0` depends on `@tailwindcss/node@4.3.2`, which pins
`tailwindcss@4.3.2` exactly; the app's `^4.1.17` floated to `4.3.3` and forked
the graph. The peer ranges that also want `tailwindcss` (`uniwind` `>=4`,
`tailwind-variants` `*`) are both satisfied by `4.3.2`. Net lockfile change:
2,322 → 2,320 package entries — exactly those two — and names resolving to more
than one version: 225 → 223.

### Rejected this pass

- **Dropping the direct `jsdom` devDep.** It looks redundant — `jsdom@20.0.3`
  arrives anyway through `jest-expo` → `jest-environment-jsdom@29.7.0`, and
  removing the declaration changed zero lockfile entries. But knip's Jest plugin
  resolves a `@jest-environment jsdom` docblock to the `jsdom` package itself,
  so removal turned three passing files into "unlisted dependency" errors. The
  choice was a redundant-looking declaration or a new `ignoreDependencies` entry,
  and per the previous pass's principle — keep the surface visible to the static
  check rather than hidden by configuration — the declaration stays.
- **Replacing `@gandlaf21/bolt11-decode` in `wallet/src/bolt11.ts`.** Its whole
  dependency footprint is `bech32@1`, `bn.js@4`, and `buffer`, and `@scure/base`
  (already in the graph, and already supplying `bech32` to
  `shared/lib/nostr/zap/buildZapRequest.ts`) could back an owned decoder. It is
  still an invoice parser on the payment path, where `amountMsat` gates what the
  user is shown and approved for — see the BTC-10 note in that file. Hand-rolling
  it fails the security gate for a sub-1 MB win. Worth revisiting only with
  invoice-vector coverage in place first.
- **`react-dom` / `react-native-web`.** Neither is imported by app source and
  the `web` block in `app.json` ships nothing, which reads as removable. It is
  not: `jest-expo/config/getPlatformPreset.js` maps `^react-native$` to
  `react-native-web`, so the entire 304-suite Jest lane runs on it, and
  `react-dom` is a peer of both it and `expo-router`'s Radix dependencies.
- **`tailwind-merge`.** Three `cn()` call sites is thin, but `heroui-native@1.0.4`
  and `tailwind-variants` both peer-depend on it, so it is present regardless —
  as `shared/lib/classNames.ts` already documents.

### Still open

- **Vendor `ndk-mobile`'s three used pieces and drop the root.** This is the only
  path that removes `ndk-wallet`, `@cashu/crypto@0.3.4`, `@noble/hashes@1.8.0`
  and `@scure/bip39@1.6.0` from the *lockfile* rather than the bundle. Sized
  above (~750 lines); the SQLite cache adapter's on-device migration is the risk
  that makes it a planned change. The repo already has a vendoring precedent in
  `@internet-privacy/marmot-ts` (`file:./vendor/marmot-ts` plus a
  `vendor:marmot-ts` script).
- **Re-run barrel reachability on the other heavy roots.** This pass walked the
  one that looked most suspicious. `heroui-native` (74 files), `@expo/ui`, and
  `@gorhom/bottom-sheet` have not been checked with this lens.
- Two Nostr client libraries coexist: `nostr-tools` (41 files) and
  `@nostr-dev-kit/ndk-mobile` (32 files). Consolidating is a real architectural
  decision, not a cleanup, and is out of scope for a dependency pass.
- The remaining old crypto copies come from the vendored `marmot-ts` →
  `applesauce-*` chain (`@noble/secp256k1@1.7.2`, the `@noble/ciphers` 2.1.1/2.3.0
  split) and from `@cashu/crypto@0.3.4` as described above. Both are upstream
  problems; a root `overrides` entry forcing Noble v2 onto a `^1.x` consumer
  would be a silent API break on a crypto path and must not be used as a
  deduplication shortcut.
- `react-native-image-colors` still reaches `node-vibrant` → `jimp`
  (`pixelmatch@4.0.2`, `file-type`, `buffer`). The 2026-08-20 assessment stands:
  packaging split upstream, do not hand-roll.
