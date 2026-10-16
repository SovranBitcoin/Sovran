# Release safety review — 2026-09-27

Baseline: `v0.1.3` (`d9ad12c4`), released 2026-09-12. Reviewed checkout:
`2a1c816c` plus the small uncommitted fixes described below. Earlier compatibility
comparison: `v0.1.0` (`d23d0723`). No commits, publication, real-wallet operations
or user-secret inspection were performed.

This is a risk-focused release review, not a line-by-line audit of all 2,257
changed files. The commit/file census covers the whole release; manual source
tracing concentrates on accounts, custody, recovery and persisted state. Broad
tests cover more features than the manual investigation. Native upgrade testing
is still required before calling this release fully verified.

## Findings and minimal fixes

1. **Missing root beneath saved accounts could generate a new identity.**
   `secureStorage.ts` already stopped on native read errors, but two successful
   null reads still reached RNG and seed persistence. A restored profile list is
   not a fresh wallet. Three regression cases reproduced replacement generation.
   Creation now checks durable account metadata and enters existing phrase
   recovery for saved/unreadable accounts. Corrupt root data also enters phrase
   recovery rather than the imported-nsec form. Existing valid roots are returned
   unchanged. Fresh absent/empty profile metadata still allows normal creation.

2. **Concurrent Routstr recovery submitted the same token twice.**
   `Promise.all([sweepUnsettledPayments(), sweepUnsettledPayments()])` produced two
   receives for one journalled token. Both callers could pass the mint-state probe
   before either swap. Sweeps now share an in-flight promise per SDK instance;
   wallet adapters also share a receive per Coco manager and normalized token,
   covering a simultaneous response and sweep. Failed in-flight work is released,
   not permanently cached. Regression tests cover shared success and later retry.
   Legacy balance and pending-payment recovery also coalesce per manager, so a
   manual reclaim cannot duplicate the same startup pass. An aborted pass retains
   its credentials, and a later pass can retry.

3. **Four UI test suites had stale native mocks.** Updated only their navigation
   context and Reanimated `makeMutable` mocks. No production UI or snapshot change.

Decision: [ADR 0018](https://github.com/SovranBitcoin/Sovran/blob/main/app/docs/adr/0018-recovery-must-not-replace-or-repeat-custody.md).

## Account identity and the re-import guard

`app/shared/lib/nostr/keyDerivation.ts` is identical to v0.1.3. Its v0.1.0
comparison changes imports/export visibility, not derivation:

| Identity | Stable input/path |
| --- | --- |
| Nostr derived account | BIP-39 root, `m/44'/1237'/accountIndex'/0/0` |
| Cashu derived account | Root, `m/44'/129372'/0'/accountIndex'/0/0`; child private key encoded as BIP-39, then PBKDF2 seed |
| Imported Nostr account | Imported nsec; does not derive that identity from the root |
| Imported account's Cashu wallet | Root plus pubkey modulo 2^31, `m/44'/129372'/0'/npubNumber'/1/0` |

Fixed vectors cover ordinary accounts 0 and 1 and an imported account. Cashu DB
names remain `coco.db` and `coco-N.db`; the manager and repository wrapper did not
change since v0.1.3.

`Saved account requires re-import` guards absent or mismatched imported keys.
It is not evidence that the derivation algorithm changed. A row incorrectly
classified as imported is repaired only when root derivation proves the stored
pubkey and old chain caches can be cleared. Genuine missing imported keys must
be supplied again; the root cannot recreate an independently imported nsec.

The current provider deliberately allows a derived row/pubkey mismatch to boot,
preserving the old release's behavior and existing data scope. This can preserve
access to stored proofs, but **does not prove the current root is the original
root or restore missing historical identity keys**. This review does not silently
rewrite those rows or change their derivation. The new guard prevents creating
another such state when account metadata remains available.

## Coco, patches and failed receive history

Both v0.1.3 and this checkout use Coco core/Expo SQLite/React **2.0.0**, and
cashu-ts **5.0.0-rc.4**. No Coco package patch remains registered. Independent
comparison of all 13 published Coco core files with the installed package found
no missing or different files; the tarball matched registry SHA-512 integrity.

The sibling `../../coco` checkout is ahead of that release; review used its
**v2.0.0 tag** and installed bundle for shipped behavior, not its current HEAD.

| Change | Reason and disposition |
| --- | --- |
| Historical Coco P2PK patch (`5ee24f74`) | Added refund signing and rollback swaps. It extended custody behavior beyond upstream. |
| Follow-up (`4f002419`) | Moved refusal before rollback state mutation; did not establish live mint safety. |
| Removal (`42ec8891`) | Entire core patch removed. Timed locks are disabled; permanent locking retains upstream limitations. |
| Remaining cashu-ts patch | Payment-request `mp` encoding/decoding and constructor/type compatibility, plus unsupported single-mint request rejection. Does not change proof persistence, seed derivation or RNG. |
| Remaining Routstr SDK patch | React Native hostname guard and recognition of its network-failure spelling. Does not introduce a second wallet. |

Vanilla Coco's `ReceiveOperationService.init` persists an operation before
execution. A failed swap can therefore leave a spent-token history row even
without a completed received token. Such rows do not prove that custom code
inserted spendable proofs. The app now avoids the demonstrated duplicate calls;
it does not erase existing history.

Existing Sovran repository adaptations remain: an ephemeral identity-key overlay
keeps the Nostr signing key out of plaintext SQLite; the counter wrapper prevents
lowering the derivation high-water mark. They predate v0.1.3 and are not package
patches. No new proof insertion/storage behavior was added in this review.

## Routstr and persisted state

The v0.1.3 live API key/balance had no issuer field and used
`https://api.routstr.com/v1`. Current migration explicitly archives an absent/null
issuer under `https://api.routstr.com`, preserving credentials and balance. It
does not assign the legacy balance to the new discovery default. Tests cover
legacy v1 hydration and issuer preservation. No real key was sent to a provider.

The secure persistence adapter refuses to overwrite an owner blob it could not
read. Profile ownership guards remain in the SDK and wallet adapter. Reviewed
persisted settings, mint and lifecycle additions use tolerant defaults; schema,
round-trip, enum-tolerance and scoped-storage tests pass. This is fixture-based
coverage, not evidence that every historical on-device blob is valid.

Confirmed-spent recovery records stay available: spent proofs alone cannot tell
whether this wallet received them or another party spent them. The best-effort
probe suppresses a receive only for a complete all-spent answer. Probe failure
falls back to Coco; it is not success or a reason to erase the recovery record.

## Entropy and older-version limits

Main root generation draws 16 bytes / 128 bits from `crypto.getRandomValues`.
`index.js` loads the shim first; QuickCrypto installation and a real draw must
succeed. No predictable fallback was found in this path. Nostr and Cashu key
derivation is deterministic; its longer outputs do not add independent entropy.
Tests exercise unavailable/throwing RNG and key-read failures without key writes.

Two inherited limitations prevent an all-versions/all-keys safety claim:

- Commit `b391f3d4`, already in v0.1.3, removed Redux bootstrap and Redux-to-Coco
  proof migration. A user who never crossed that migration has no demonstrated
  direct upgrade path. Do not assume installing 0.1.3 first would fix this: it
  already lacks the migration. Identify that cohort and restore/test an importer
  before promising universal older-version support.
- BitChat iOS vendor code still ignores `SecRandomCopyBytes` status for its
  device seed (`NostrIdentityBridge.swift:100`) and encryption nonce
  (`NostrProtocol.swift:294`). On native RNG failure those paths can proceed
  with invalid/predictable material. This predates v0.1.3 and is separate from
  the main wallet RNG. It remains unfixed and needs status-checked native draws
  plus failure-injection validation.

## Validation

Validation completed so far:

| Check | Result |
| --- | --- |
| Root `bun run type-check` | All workspaces passed, including app iOS and Android |
| Root lint | Zero errors; 192 existing warnings. Changed-file lint also passed with existing warnings |
| Wallet Vitest | 98 files, 1,550 tests passed |
| Nostr Vitest | 37 files, 344 tests passed |
| App Jest, `--maxWorkers=2` | 570 suites, 5,533 tests, 168 snapshots passed |
| Final legacy-reclaim change | 23 focused tests passed, including three new concurrency/cancellation cases |
| iOS / Android Metro production exports | Both passed (`--no-bytecode`; native binaries not built) |
| JSON native harness validation | Passed |
| `git diff --check` | Passed |

The full app result precedes the final legacy-reclaim addition; its focused
suite was run after that edit. The first full run found the four stale-mock
failures fixed above. A subsequent
unbounded-worker run timed out in `profileSwitchOrdering` while both exports
were running; the bounded run passed. Jest still reported a worker teardown/open
handle warning. No test timeout was raised and no assertion was weakened.

No funded E2E or live mint operations were run. Metro exports do not validate
native compilation, device CSPRNG behavior, process-death recovery or an actual
installed-app upgrade. The existing `recovery.secure-locked` JSON scenario was
validated but not executed on either platform.

Hunch 0.22.0 `check --base origin/main` reported five candidates and partial
coverage. The NUT-07 probe is optional and catches unsupported responses; it
does not require that capability to proceed. Two app-layer ownership warnings
are architectural follow-ups. The SDK adapter must return the SDK's string-shaped
receipt; this review does not treat that message as proof of settlement. The
shared `.catch([])` fallback is not mutated by the reviewed immutable reducers.
Insufficient-context/deleted-hunk notices and broader policy `notChecked` entries
remain coverage gaps; this is not a clean automated-review claim.

## Follow-up: shim and crypto dependency changes

The follow-up review checked three independent layers: the release diff,
installed dependency source/provenance, and emitted production modules. No new
crypto regression was found in this scope. No dependency, override or shim was
changed as a result of this follow-up.

### Bootstrap and resolution

- `app/index.js`, `app/polyfills.js` and Babel configuration are unchanged from
  v0.1.3. The shim adds RN core initialization and the stream-capable Response
  wrapper. The wrapper has no crypto imports or entropy reads.
- Both emitted app entries require the shim before app consumers. The shim
  installs QuickCrypto, probes its RNG and requires SubtleCrypto. Expo/RN
  pre-main initialization runs earlier; its static dependency closure was also
  inspected and no early crypto-provider capture was found. This is not a claim
  that the shim is literally the first module evaluated.
- QuickCrypto 1.1.7 still installs the global crypto provider, and its native
  random-fill implementation checks `RAND_bytes` for failure. The MessageChannel
  polyfill does not replace crypto. The bundled `react-native-get-random-values`
  installer fills only a missing RNG and therefore does not replace QuickCrypto.
- New Metro mappings are Node filesystem stubs, streams and gzip decompression.
  No new `crypto` or `node:crypto` redirection was added. Source maps contain the
  browser/global Noble crypto entry points, not `cryptoNode` providers.

### Exact version changes

| Dependency/path | v0.1.3 to reviewed checkout |
| --- | --- |
| QuickCrypto | 1.1.7 unchanged |
| App BIP32 / BIP39 / Scure base | 2.3.0 unchanged |
| App Noble hashes | 2.3.0 unchanged |
| nostr-tools | 2.24.2 unchanged; its Noble curves/hashes remain 2.0.1 and ciphers 2.1.1 |
| Coco / cashu-ts | 2.0.0 / 5.0.0-rc.4 unchanged |
| Root Noble curves / ciphers | 2.3.0 to 2.4.0 |
| Cashu / Coco / BIP32 / ts-mls curve dependencies | Retain 2.3.0 through nested copies |
| Installed Marmot dependency branch | Vendor source unchanged; resolves newer curves/ciphers/hashes 2.4.0 |
| ts-mls / native CDK | 2.0.0-rc.7 / commit 3007137 unchanged |
| Routstr addition | SDK 0.4.6 brings EHBP, Tinfoil/verifier, HPKE and Noble post-quantum dependencies |

Different Noble versions coexist intentionally. The inspected custody interfaces
exchange bytes/hex, not curve Point objects from incompatible package copies.
The root curves dependency's direct app imports are developer tools; it is not
the BIP32 implementation merely because it is hoisted at the root. Conversely,
Marmot must be checked at its **installed** path, not just its vendor directory:
dependency lookup differs. No blanket cross-major deduplication was attempted.

### Checks and results

- Fresh iOS and Android production exports with source maps passed, with dotenv
  loading disabled. They contain 6,345 and 6,323 source entries respectively and
  the same 51 selected crypto/SDK package directories / 38 npm package identities.
- Compared 5,540 published regular files across those installed directories with
  registry tarballs, verifying each tarball's integrity. All matched except two
  expected cashu-ts patch files, twelve registered Routstr SDK patch files, and
  eight expected vendored Marmot differences.
  All 168 vendored Marmot files independently matched the installed vendor copy.
- Executed the actual emitted derivation modules and their real bundled JS
  dependencies from **both** platforms in a Node VM. Accounts 0 and 1 and the
  imported-account fixture reproduced their fixed public-key/wallet-seed vectors.
  Only logging was stubbed in that graph; the VM crypto boundary used Node's
  CSPRNG. Repeating with an unavailable RNG preserved the deterministic outputs:
  Noble's optional arithmetic-blinding probes can fail independently of key
  derivation. This does **not** bypass the separately tested app bootstrap guard
  or permit fresh seed creation without randomness.
- Integrity-checked isolated Noble 2.3/2.4 comparisons passed: 19 official BIP340
  vectors under each version, 24 ECDSA comparisons, 24 ECDH cases against Node,
  AES-GCM/ChaCha20-Poly1305/CBC against Node, tamper rejection, XChaCha comparisons,
  hash/HMAC/HKDF/PBKDF checks, and Buffer/cross-realm/subarray inputs.
- The real Marmot binary NIP-44 module produced identical conversation keys and
  ciphertext, with bidirectional old/new decryption over ten lengths up to
  65,535 bytes. Its source is unchanged; this exercises its changed dependencies.
- Bootstrap, UTF-8, Response streaming, account vectors and seed-preservation
  regression tests: **five suites / 46 tests passed**.

These results strengthen JS upgrade compatibility evidence. The VM uses Node,
not Hermes or the QuickCrypto native binary. Native linking, actual device RNG,
and a complete live Tinfoil/MLS session were not validated by these checks.
The earlier native BitChat and historical migration limitations still apply.

## Performance follow-up (2026-09-28)

Compared release diagnostic behavior with `v0.1.3`, concentrating on logging,
content-shift instrumentation, list renders, keyboard callbacks and new timers.
This is a source and operation-count review, not a measured device FPS/TTI or
battery comparison.

Three new call-site costs were fixed with existing logger gates:

- `MintListScreen`: diagnostic-only hidden-row filtering and serialization now
  happen inside the effect after `cashuLog.isLevelEnabled('info')`. Previously,
  even an ALL-tab render compared every row against the visible array using
  `includes`: 100 rows require 5,050 element comparisons. Release builds now
  skip that diagnostic calculation entirely.
- `useMintSelectorFrameLog`: disabled logging returns before row enumeration,
  formatting, diff construction, serialization and diagnostic ref updates.
  The regression test observes zero row enumerations with logging disabled and
  one with logging enabled, while preserving the enabled log event.
- `ProviderListScreen`: row/list diagnostic payloads are built only when the
  recorder's info level is enabled. The telemetry-only Zustand selector returns
  stable `null` in release; it remains subscribed but cannot cause rerenders
  from changes to `knownProviders` alone.

The logger master switch remains `SHOW_LOGS = IS_DEV`, as in 0.1.3.
`contentShiftLog.ts` is unchanged from that release and selects no-op hooks;
production tests confirm it attaches no diagnostic layout/scroll handlers and
adds no window-dimension subscriptions. Render diagnostic thunks are evaluated
only after the gate. Coco's adapter checks the enabled level before formatting.
File logging, global-error interception and the opt-in JS-thread monitor also
check the master gate. Metro's console stripping and inline-require settings
are unchanged. These checks do not assert that third-party warnings/errors
are stripped: Metro deliberately preserves those levels.

Routstr SDK warning/error adaptation also carries functional refusal metadata
used by failover, so it was not disabled wholesale. Existing chat keyboard
instrumentation still allocates shared values and receives callbacks in
production; the same behavior was present in 0.1.3, and this focused patch leaves
it unchanged. New QR placeholder frame callbacks have explicit activation and
cleanup; their device rendering cost has not been profiled.

Validation: eight focused suites / 29 tests passed, including production
content-shift and render gates and the selector regression. Root type checking
passed across all workspaces, including both app platforms. Physical Release
build comparison against 0.1.3 remains necessary to establish overall frame,
startup and thermal parity; automated checks cannot certify no performance hit.

App lint completed with zero errors and the existing 192 warnings;
`git diff --check` passed. Production Metro bundling completed for Android
(6,296 modules) and iOS (6,338 modules). Metro reported dependency export-map
fallback warnings for nested Noble `crypto.js` imports and `cborg`; these are
build-time warnings, not evidence of release logging being enabled.

Explicit iOS and Android exports both completed successfully at
`/tmp/sovran-perf-ios` and `/tmp/sovran-perf-android`. The initial `--platform all`
command also attempted web and failed resolving `BalancePill` from
`AiHeaderTitle`: this component has iOS/Android entry points but no web entry.
That web build gap was not changed by this diagnostic-gating patch.
