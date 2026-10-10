# Evidence ledger

**Verdict, 2026-10-10, candidate 0.1.4 (`feat/offline-send-just-works`): INCONCLUSIVE.**

- Upgrades from **0.1.3 on Android: PASS.** The released 0.1.3 APK was upgraded in place to a
  release build of the candidate on an emulator, with nothing lost (below).
- Upgrades from **0.1.1 on Android: PASS**, with money. A release build of the 0.1.1 source
  holding 63 test sats was upgraded in place to the candidate; the balance and the history
  carried over (below). 0.1.0 and 0.1.1 are the only Android releases below 0.1.3.
- Upgrades from **0.1.3 on iOS: PASS on the simulator**, with money. A release build of the
  0.1.3 source holding 63 test sats was upgraded in place to a release build of the
  candidate; the balance, the mint and the history carried over (below). A store build on a
  phone (TestFlight) is still worth one run before release, for the device keychain.
- Upgrades from **0.0.45 to 0.0.63** had three defects that lose data or a paid credential.
  All three are fixed and tested in this run. No real upgrade from those builds was run.
- Upgrades from **0.0.1 to 0.0.40** (redux era, iOS only) no longer hand the user a new
  wallet. Their ecash is not imported; that gap was **accepted** on 2026-10-10 (ADR 31).
- **99 builds from 2024** predate this repository. What they wrote is unknown.

Third artifact of the [persistence release safety](../../../.agents/skills/persistence-release-safety/SKILL.md)
procedure. The builds are in [release-provenance.md](release-provenance.md), the durable
surface in [persistence-map.md](persistence-map.md), the role reports in
[audit-2026-10-10](audit-2026-10-10/). Tests are under `app/__tests__/`; every one named
here was run on 2026-10-10 as part of the full suite.

## Rows that are not PASS

| Epoch | Durable thing | State that fails | Status | Evidence | Verdict |
| --- | --- | --- | --- | --- | --- |
| 0.0.1 … 0.0.40 (exact for most, 151 builds unreadable) | `persist:SOVRAN` phrase | No `user_mnemonic`, no `profile-store`: the candidate generated a **new** phrase over the old wallet | **Fixed.** The phrase in the row is adopted as the root; a row that cannot be read locks instead of generating. The row is never written | `secureStorageLifecycle.test.ts` (redux-era cases); `shared/lib/nostr/reduxEraRoot.ts` | PASS for the phrase |
| 0.0.1 … 0.0.40 | `persist:SOVRAN` proofs, counters, paid mint quotes | Nothing imports them. After adoption the user is offered a restore from mints, which finds proofs made by 0.0.12 build 10 and later | **Accepted on 2026-10-10** ([ADR 31](../../../app/docs/adr/0031-ecash-from-before-coco-is-not-imported.md)). The importer existed from 0.0.45 to 0.1.1 and was removed in 0.1.2; the row is kept so it can return | `coco-and-cashu.md` findings 1, 2 | FAIL against "nothing lost"; accepted |
| 0.0.1 … 0.0.12 build 3 | Cashu seed | The seed was the raw 32-byte child key; the candidate uses the BIP39 seed of that key's entropy. The same phrase restores a different wallet | **Accepted**, same decision | `helper/cashu/wallet.ts:37@957eed9ea`; `app/shared/lib/nostr/keyDerivation.ts:78@HEAD` | FAIL |
| 0.0.45 … 0.0.56 (exact) | Every per-account store under a bare key (`routstr-store` with a paid key, `mint-store`, `scan-history-store`, …) | No `profile-store` existed, so the key migration did nothing and recorded itself; the stores were orphaned | **Fixed.** Account 0's key is derived from the stored phrase and the stores are copied to it; the originals stay until the next launch; an unreadable keychain retries next launch | `preProfileUpgrade.test.ts` (14 cases) | PASS in tests; real upgrade NOT RUN: no build of that age to install |
| 0.0.45 … 0.0.56 that already upgraded through 0.0.62 … 0.1.3 | The same bare stores | Those releases had the same gap, recorded the migration, and left the bare keys behind | **Fixed for stores the account has not saved since.** A new migration gives a leftover to account 0 when it is the phrase's first account and has none of its own; otherwise the leftover stays on disk (F87) | `preProfileUpgrade.test.ts` (leftover cases); Codex review, two defects found and fixed | PASS in tests; merge case INCONCLUSIVE |
| 0.0.51 … 0.1.0 (bounded) | `routstr-store` with more than 1,024 sessions or 10,000 messages | The key was moved to the secure vault, the blob was then rejected, and on the same launch defaults were saved over the vault: **the paid key was erased**. Reproduced before the fix | **Fixed.** Old blobs are trimmed, newest kept; and the store saves nothing until a load has been accepted | `routstrOversizedUpgrade.test.ts` (7 cases) | PASS in tests |
| any | `routstr-store` rejected for another reason | After the fix the key survives, but nothing the user does in that session is saved | **Open, F88** | verifier report, P2 | INCONCLUSIVE |
| 0.0.52 … 0.1.x | `scan-history-store` over 500 entries or a scan over 16,384 characters | The whole history was rejected, and the annotation import then recorded itself without the transaction links | **Fixed.** Reading accepts everything an earlier release wrote; the limits apply when a scan is added | `scanHistoryUpgrade.test.ts` (6 cases) | PASS in tests |
| 0.0.63 … 0.1.0 | `split-bill-transactions-store` | No reader since 0.1.1. The row stays on disk; the ecash itself is in Coco and unaffected | **Open, F89.** Already true of 0.1.3 | `persistence-investigator.md` finding 6 | FAIL (data unreachable, not lost) |
| below theme version 2 | `theme-store` album and wallpaper choices | Replaced by defaults, on purpose, since 0.1.2 | **Accepted**; recorded so it is a decision and not a surprise | `themeStoreMigrate.test.ts` | FAIL against "nothing lost"; accepted |
| any | `profile-store`, `settings-store`, `wallet-lifecycle` that cannot be read or parsed | Startup waited for ever on a blank screen | **Fixed.** Startup stops on the retry screen, and a retry reads again | `hydrationOutcome.test.ts` (9 cases); Codex review found no deadlock | PASS in tests |
| any | `profile-store` read but rejected by its schema | Opens on defaults (no accounts); bytes are kept in `:unreadable` but nothing reads them back | **Open, F72** (existing) | Codex review of the gate | INCONCLUSIVE |
| any | `settings-store` whose `state` is not an object | The theme migration threw, and Retry repeated it for ever | **Fixed** | `themeMigration.test.ts` (4 new cases) | PASS |
| 0.0.61 + | `derived_keys_<i>`, `cashu_mnemonic_<i>` with the right hash and the wrong shape | Key recovery screen on every launch although the phrase was fine | **Fixed.** A wrong-shaped cache counts as absent and is derived again | `secureStorageLifecycle.test.ts` | PASS |
| any | Coco restore | Upstream sets the counter to 0 after recovering the signature at counter 0, so the next output reuses it | **Open, F90.** Not an upgrade defect; Coco stays unpatched | `node_modules/@cashu/coco-core/dist/index.js:3466` | INCONCLUSIVE |
| any | Wallet database missing while the lifecycle says restored | An empty wallet opens with no restore prompt | **Open, F91** | `adversarial-and-recovery.md` | INCONCLUSIVE |
| any | Profile removal or delete-all killed partway | No durable record of the step reached; a cold retry of removal refuses | **Open, F92** | `adversarial-and-recovery.md` | INCONCLUSIVE |
| any | Stored phrase B over account data of phrase A | Accepted with a log line | **Open, F93** | `coco-and-cashu.md` finding 4 | INCONCLUSIVE |

## Rows that pass in tests

Each is a durable thing 0.1.0 to 0.1.3 wrote, read by the candidate with nothing lost. The
released shape and the candidate reader for every row are in the persistence map.

| Durable thing | Fixture / test | Fault cases | Real upgrade |
| --- | --- | --- | --- |
| Store names, scopes and versions of 0.1.3 | `releasedPersistedSurface.test.ts` | n/a | JS-level, below |
| Whole 0.1.0 / 0.1.3 install through the migration runner | `releaseUpgrade.test.ts`, `globalMigrationsRunner.test.ts` | interrupted copy, corrupt marker, marker read failure, run twice | 0.1.3 binary on Android, below |
| `settings-store` v0 … v4 | `settingsStorePersistResilience.test.ts`, `persistedEnumTolerance.test.ts` | wrong-shaped state | JS-level |
| `profile-store` v0 … v2, capacity | `profileStorePersistResilience.test.ts`, `profileStoreCapacity.test.ts` | unknown source, bad active index | JS-level |
| `wallet-lifecycle` | `lifecycleStampMigration.test.ts` | pending / failed restore kept | JS-level |
| `user_mnemonic`, key caches, `secure_key_index` | `secureStorageLifecycle.test.ts`, `loadAccountKeys.test.ts` | missing, corrupt, unreadable keychain | JS-level |
| Mint caches merged into `mint-metadata-store` | `mintMetadataStore.test.ts` | n/a | JS-level |
| Side data into annotations | `dataMigrations.test.ts` | rejected write, wait for durable write | JS-level |
| `btcmap-store` row to cache file | `fileCacheStorage.test.ts` | unreadable Android row, cut-short write | Android emulator, 5.3 MB row freed |
| Any store rejected by its schema | `persistUnreadableGuard.test.ts` | read throws, copy fails, second failure | n/a |
| Every schema against its golden shape | `persistSchemaDrift.test.ts` | n/a | n/a |

## Real upgrades

**Released 0.1.3 binary to a candidate release build, Android, 2026-10-10.**

| | |
| --- | --- |
| Old | `sovran-0.1.3.apk` from the GitHub release, SHA-256 `2fca9101…58a941`, the same file the pipeline recorded for Play and Zapstore (`versionCode` 24) |
| New | `assembleRelease` of commit `3965e66bb`, arm64, `versionCode` 25, version 0.1.4 |
| Signing | Both re-signed with one local debug key (certificate `204df835…b14588`), because Play holds the real key. Nothing inside either APK was changed. Android ties an app's data and its Keystore entries to the package and its user id, not to the certificate, so this exercises the same storage path as a store update |
| Device | Android 16 emulator (API 36.1, arm64) |
| State made on 0.1.3 | Terms accepted, wallet created (`driven-lion`, `npub124a…vsukles6`), a second account generated (`vivid-cheetah`, `npub1ksm…dq5vhlp9`) and left active, Minibits mint selected |
| Upgrade | `adb install -r` over the stopped app; `firstInstallTime` kept, so the data was not cleared |
| After, on the candidate | Opened straight to the wallet: no terms, no onboarding, no restore prompt, no retry screen. Same account active with the same npub; both accounts listed; mint still selected. Switched to the first account: same name and npub. Stopped and started again: still there. No error, refusal or recovery line from the app in the device log |
| Not covered | Funds (both wallets were empty), Routstr, an install older than 0.1.3, iOS |

**0.1.1 release build, funded, to the same candidate build, Android, 2026-10-10.**

| | |
| --- | --- |
| Old | `assembleRelease` of `4203ea8ec` (0.1.1, the commit `main` was at when the 0.1.1 builds were made; EAS recorded no commit and its APKs have expired, so this is a rebuild, not the shipped file), `versionCode` 21. It carries Coco 1.0.1 and the storage modules of that release |
| New | The same candidate APK as above (`3965e66bb`, `versionCode` 25), same local key |
| State made on 0.1.1 | Terms accepted, wallet created, a 64 sat token from the public test mint (`testnut.cashu.space`, fake payments, no real money) pasted and redeemed, test mint trusted. Balance 63 after the swap fee, one receive in the history |
| After, on the candidate | Asked to accept the updated terms and privacy documents (they changed after 0.1.1), then opened the wallet. The receive of 64 is in the history; the candidate offered a backup "because you have money here now"; the test mint is listed with **₿ 63**, under test bitcoin where the candidate files test mints. Stopped and started again: history still there. No error, refusal or recovery line from the app in the device log |
| What this adds | A wallet database written by Coco 1.0.1 is opened and migrated by Coco 2.0.0 with its proofs intact, and the 0.1.1 stores (settings v3, profile v1) are read |
| Not covered | Spending the migrated proofs; several accounts; Routstr; iOS |

**0.1.3 release build, funded, to a candidate release build, iOS simulator, 2026-10-10.**

| | |
| --- | --- |
| Old | `xcodebuild -configuration Release -sdk iphonesimulator` of tag `v0.1.3` (`d9ad12c4b`), with Xcode's normal simulator signing so the keychain works. A rebuild for the simulator: a store build cannot run there |
| New | The same build of the candidate (`3965e66bb`, version 0.1.4), same bundle id |
| Device | iPhone 17 Pro Max simulator |
| State made on 0.1.3 | Terms and privacy accepted, wallet created, a 64 sat token from the public test mint pasted and redeemed (balance 63 after the fee), test mint trusted |
| Upgrade | App terminated, `simctl install` of the candidate over it |
| After, on the candidate | Opened with no terms, onboarding or restore prompt, straight to the backup offer "because you have money here now". The receive is in the history; the test mint is listed with **₿ 63** under test bitcoin. Read directly from the app's `coco.db` after the upgrade and again after a cold start: 6 proofs, all `ready`, summing 63. No failed load, refused write or failed migration in the device log |
| What this adds | The iOS keychain items and the wallet database written by 0.1.3's native code are read by the candidate's, on iOS |
| Not covered | A store-signed build on a phone; several accounts; spending the proofs |

Earlier, weaker runs (in `PERFORMANCE.md`): 0.1.3's JavaScript, then the candidate's, inside
the candidate's native build, on a fresh Android emulator and a fresh iOS simulator, with
nothing lost.

To repeat it: download the release APK, `apksigner sign` it and a local `assembleRelease`
(with a higher `versionCode`) with the same keystore, install the first, make state, then
`adb install -r` the second.

## Not covered at all

| Gap | Why | Unblocked by |
| --- | --- | --- |
| A Coco database written by 0.6.0, rc.11, rc.30, rc.34, rc.47, 1.0.0 opened by 2.0.0 (1.0.1 is shown above) | No database files from those builds exist to test with | Building one old revision per Coco version in a simulator and keeping its `coco.db` as a fixture |
| SecureStore on a real iPhone keychain, and across native versions older than 0.1.1 | Shown on Android (0.1.1, 0.1.3) and the iOS simulator (0.1.3) | One TestFlight upgrade on a phone |
| The 99 builds from 2024 | Source is not in this repository | The earlier repository |
| Which builds are still installed | EAS does not record it | App Store Connect and Play Console (questions in the provenance record) |
| Android signing certificate named in the old release guide differs from 0.1.3's | Probably upload key against Play's signing key; not confirmed | Play Console → App integrity |
| Two launches at once; a native call that never returns at startup | No test seam | F92, F83 |
