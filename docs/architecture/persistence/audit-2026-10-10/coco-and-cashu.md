**Verdict: FAIL for universal upgrade/phrase-recovery safety. Historical Coco SQLite compatibility remains INCONCLUSIVE.** These are source findings; no native upgrades or tests were run.

`HEAD` = `5651d4720`. References below use `path:line@revision`. Dependency references labelled HEAD-installed mean the installed bundle, tied to HEAD’s lockfile.

### 1. Storage and derivation epochs

Derivation notation:

- **D32:** root phrase → BIP39 seed, empty passphrase → `m/44'/129372'/0'/i'/0/0` → raw 32-byte child private key supplied to Cashu. `helper/cashu/wallet.ts:35–59@957eed9ea`.
- **D64:** same child key → entropy-to-mnemonic → BIP39 seed, empty passphrase, 64 bytes. `helper/cashu/wallet.ts:39–45@1138cf435`; `app/shared/lib/nostr/keyDerivation.ts:66–89@HEAD`.
- **I64:** imported-account branch uses `m/44'/129372'/0'/i'/1/0`, with the imported pubkey mapped into the account index. `shared/lib/nostr/keyDerivation.ts:116–131@19388f0e3`; `app/shared/lib/nostr/keyDerivation.ts:123–146@HEAD`.

| Epoch; representative revision | Proof storage / database names | Resolved libraries | Seed |
|---|---|---|---|
| 0.0.1–0.0.12 build 3; `957eed9ea`, `f599f03bd` | Redux persisted in AsyncStorage; later source shows per-profile, per-mint proofs and counters, persistence key `SOVRAN`. `helper/redux/cashu/reducer.ts:24–34@a09fe2d54`; `helper/redux/store/index.ts:353–361@a09fe2d54` | cashu-ts **2.2.2**, no Coco. `yarn.lock:1262–1264@957eed9ea` | **D32**, including `helper/cashu/wallet.ts:36–40@f599f03bd` |
| 0.0.12 build 10–0.0.24; `1138cf435`, `a09fe2d54` | Same Redux proof/counter storage. `helper/redux/cashu/reducer.ts:73–78@a09fe2d54` | cashu-ts **2.2.2**. `yarn.lock:892–894@a09fe2d54` | **D64**; later stored separately as profile `nut13`. `helper/cashu/wallet.ts:66–72@a09fe2d54`; `helper/redux/store/index.ts:241–267@a09fe2d54` |
| 0.0.45; `bab1c891f` | Coco SQLite **`coco.db`**; importer gathers Redux profiles into that manager. `helper/coco/manager.ts:84–86@bab1c891f`; `helper/coco/migration.ts:104–118@bab1c891f` | coco-cashu-core **1.0.0-rc10**, SQLite **0.6.0**, cashu-ts **2.7.2**. `yarn.lock:4549–4558,843–845@bab1c891f` | D64; fallback explicitly profile 0. `helper/coco/manager.ts:92–108@bab1c891f` |
| 0.0.51 builds 1/3; `3d34a34bd` | Coco singleton-era storage | Manifest requests **rc.25**, lock resolves core/SQLite **1.0.0-rc11**; cashu-ts **2.7.2**. `package.json:69–70@3d34a34bd`; `package-lock.json:7057–7070,1737–1739@3d34a34bd` | D64 singleton-era derivation |
| 0.0.51 builds 4–9; `3502127d2` | Coco singleton-era storage | core/SQLite **1.1.2-rc.30**; app cashu-ts **2.7.2**, nested **2.8.1**. `package-lock.json:7057–7073,7176–7178,1737@3502127d2` | D64 |
| 0.0.52–0.0.56; `99eb79aaa` | Singleton-era importer still processes all profiles; imports mints, proofs, counters only. `helper/coco/migration.ts:19–41@99eb79aaa` | core/SQLite **1.1.2-rc.34**, app cashu-ts **2.7.2**, nested **2.8.1**. `package-lock.json:7424–7440,7543–7545,1736@99eb79aaa` | D64 |
| 0.0.58–0.0.61; `59a27ff7a`, `a838d5bc3` | **`coco.db`** for 0, **`coco-i.db`** otherwise; importer scoped to account index. `helper/coco/manager.ts:49–55,100–130@59a27ff7a`; `helper/coco/migration.ts:14–60@59a27ff7a` | core/SQLite **1.1.2-rc.47**, cashu-ts **3.3.0**. `package-lock.json:7934–7936,7998–8000,1644–1646@59a27ff7a` | Indexed D64. `helper/coco/manager.ts:121–130@59a27ff7a` |
| 0.0.62–0.0.63; `19388f0e3`, `28bf7713a` | Same account-indexed filenames. `shared/lib/cashu/manager.ts:85,143@19388f0e3`; `:86,148@28bf7713a` | `@cashu/coco-core` / expo-sqlite **1.0.0-rc.0**, cashu-ts **3.5.0**. `package-lock.json:1870,1923,1975@19388f0e3`; `bun.lock:400–404@28bf7713a` | D64 / I64. `shared/lib/nostr/keyDerivation.ts:54–77,116–131@19388f0e3` |
| 0.1.0; `88fad9741` | Same filenames. `shared/lib/cashu/manager.ts:96,148@88fad9741` | Coco packages **1.0.0**, cashu-ts **3.5.0**. `bun.lock:408–412@88fad9741` | D64 / I64. `shared/lib/nostr/keyDerivation.ts:65–88,127–142@88fad9741` |
| 0.1.1; `4203ea8ec` | Same filenames. `shared/lib/cashu/manager.ts:132,212@4203ea8ec` | Coco packages **1.0.1**, cashu-ts **3.5.0**. `bun.lock:399–403@4203ea8ec` | Same derivation. `shared/lib/nostr/keyDerivation.ts:65–88,127–142@4203ea8ec` |
| 0.1.2–HEAD; `148ebd085`, `d9ad12c4b`, `HEAD` | Same filenames; opens existing DB and initializes repositories. `app/shared/lib/cashu/manager.ts:682–706,737–741@HEAD` | Coco packages **2.0.0**, cashu-ts **5.0.0-rc.4**. `bun.lock:439–443@148ebd085`; `bun.lock:459–463@HEAD` | D64 / I64; seed cache checked against mnemonic hash and account index. `app/shared/lib/cashu/manager.ts:749–768@HEAD` |

**Manifest/lock discrepancy:** the early 0.0.51 manifest and committed lock disagree. The table reports the lock resolution, not proof of the library bundled in a released binary.

**Nostr cache:** 0.0.58–0.0.61 still used one database, **`nostr`**, rather than `nostr-i`. Account-indexed names appear by 0.0.62 and persist at HEAD. `providers/NostrNDKProvider.tsx:8@59a27ff7a`; `:9@a838d5bc3`; `shared/providers/NostrNDKProvider.tsx:32@19388f0e3`; `app/shared/providers/NostrNDKProvider.tsx:156–165@HEAD`.

### 2. Invariants

| Invariant | Verdict and evidence |
|---|---|
| Balance before equals balance after | **FAIL universally; INCONCLUSIVE for historical SQLite upgrades.** HEAD has no Redux proof importer; its migration registries contain other migrations only. `app/shared/lib/migrations/globalMigrations.ts:336–340@HEAD`; `dataMigrations.ts:40–45@HEAD`. SQLite pre/post balance diagnostics do not enforce equality. `app/shared/lib/cashu/manager.ts:476–551,594–611@HEAD`. |
| No proof dropped, duplicated or moved between accounts/mints | **FAIL for historical account separation.** The first Coco importer loops all profiles into one manager, marking proofs ready. `helper/coco/migration.ts:104–118@bab1c891f`. From 0.0.58 the importer is account-scoped. `helper/coco/migration.ts:14–60@59a27ff7a`. HEAD SQLite preserves proof fields during amount conversion, but historical fixture validation is missing. `node_modules/@cashu/coco-expo-sqlite/dist/index.js:79–132@HEAD-installed`. |
| Counters never go backwards / reuse signed outputs | **FAIL.** Historical importer overwrites the same mint/keyset counter for successive profiles. `helper/coco/migration.ts:154–158@bab1c891f`. HEAD adds a monotonic wrapper, but restore’s counter-zero bug remains; see finding 3. `app/shared/lib/cashu/cocoRepositories.ts:175–199@HEAD`. |
| Pending operations remain recoverable | **FAIL for Redux-era paid mint quotes.** Old quotes lived in Redux transactions; importers copy only mints/proofs/counters. `helper/cashu/pay.ts:312–332@a09fe2d54`; `helper/coco/migration.ts:33–41@99eb79aaa`. HEAD does recover Coco send/melt/receive operations and reconcile legacy **Coco** mint quotes. `app/shared/providers/CocoProvider.tsx:120–164@HEAD`; `app/shared/lib/cashu/manager.ts:1026–1100@HEAD`. |
| Same phrase opens same wallet in every epoch | **FAIL.** D32 becomes D64 at 0.0.12 build 10. `helper/cashu/wallet.ts:36–40@f599f03bd`; `:39–45@1138cf435`. HEAD accepts a 64-byte wallet seed, with no D32 recovery branch. `wallet/src/wallet-seed.ts:257@HEAD`. |
| Old Coco DB is opened and migrated, not recreated empty | **Source supports this; historical compatibility INCONCLUSIVE.** HEAD opens the existing named DB and calls repository initialization. `app/shared/lib/cashu/manager.ts:682–706,737–741@HEAD`. Coco records each migration in the same transaction as its changes. `node_modules/@cashu/coco-expo-sqlite/dist/index.js:1385–1409@HEAD-installed`. Initialization failure throws rather than resetting the DB. `app/shared/lib/cashu/manager.ts:887–894@HEAD`. |
| Pre-Coco proofs imported, or retained and phrase-restorable | **FAIL as a complete guarantee.** No current importer was found. The old Redux blob is not shown being deleted, but retained bytes do not make funds accessible; early D32 proofs also fail HEAD’s phrase derivation. Old persistence: `helper/redux/store/index.ts:353–361@a09fe2d54`; current migration registries above. |
| Coco filenames stable since 0.0.58 | **Supported by source.** Account 0 remains `coco.db`; account i remains `coco-i.db`, including intervening release references in the table. `helper/coco/manager.ts:49–55@59a27ff7a`; `app/shared/lib/cashu/manager.ts:682–706@HEAD`. |

HEAD’s SQLite adapter owns schema creation and upgrades, including counters, proofs, quote tables and durable send/melt/receive/mint operations. Its migration chain includes table-copy conversions, mint-URL normalization and legacy quote reconciliation. `node_modules/@cashu/coco-expo-sqlite/dist/index.js:414–478,558–584,588–783,931–933,1028–1202@HEAD-installed`.

The sanctioned Coco patch adds offline send preparation; it is not a legacy storage or seed migration. `app/patches/README.md:12@HEAD`.

### 3. Findings, ranked

1. **Critical — skipped pre-Coco upgrade strands a paid, unclaimed mint quote.**  
   Concrete state: 0.0.24 has a persisted Lightning receive transaction containing `mintQuote`; its invoice is paid, but the app closes before requesting signatures. Upgrade directly to HEAD. The quote exists only in Redux, which HEAD does not import. Phrase restoration cannot recover signatures that were never issued. Old quote persistence: `helper/cashu/pay.ts:312–332@a09fe2d54`. Even historical importers omit quotes: `helper/coco/migration.ts:33–41@99eb79aaa`. HEAD’s registries provide no replacement importer: `app/shared/lib/migrations/globalMigrations.ts:336–340@HEAD`; `dataMigrations.ts:40–45@HEAD`. **Stranded through app recovery; permanent mint-side loss is not established.**

2. **Critical — early phrase recovery opens a different deterministic Cashu wallet.**  
   Concrete state: unspent proofs were generated in 0.0.12 build 3 or earlier using D32; recovery at HEAD has the same phrase but no usable proof database. HEAD derives D64, so its restore outputs differ from the original wallet. `helper/cashu/wallet.ts:36–40@f599f03bd`; `:39–45@1138cf435`; `app/shared/lib/cashu/manager.ts:749–761@HEAD`; `wallet/src/wallet-seed.ts:257@HEAD`. Existing bearer proofs are not invalidated, but HEAD’s phrase recovery does not recover that epoch.

3. **High — restore persists counter 0 after recovering a signature at counter 0.**  
   Concrete state: no counter row exists; restore finds exactly the signed output at counter 0. Coco calculates:
   `lastCounterWithSignature ? lastCounterWithSignature + 1 : 0`, producing **0 instead of 1**. `node_modules/@cashu/coco-core/dist/index.js:3466–3473@HEAD-installed`. cashu-ts can return a valid zero last-counter value. `node_modules/@cashu/cashu-ts/lib/cashu-ts.es.js:5736–5749@HEAD-installed`. The app’s monotonic guard cannot raise an absent counter to 1; the next deterministic output starts at the stored counter. `app/shared/lib/cashu/cocoRepositories.ts:175–199@HEAD`; `node_modules/@cashu/coco-core/dist/index.js:2564–2595@HEAD-installed`. **Source-traced output reuse; mint rejection was not executed.**

4. **High — a valid but different stored root is accepted for an existing derived account/database.**  
   Concrete state: profile i and `coco-i.db` belong to phrase A, while SecureStore contains valid phrase B. HEAD derives B’s signer and Cashu seed, logs the pubkey mismatch, then continues against i’s existing database. `app/shared/lib/nostr/loadAccountKeys.ts:191–203@HEAD`; `app/shared/lib/cashu/manager.ts:682–706,749–761@HEAD`. This mixes old account data with a different active identity/seed. The new absent-keychain guard prevents generating another root when `profile-store` exists, but does not repair an already mismatched valid root. `app/shared/lib/nostr/secureStorage.ts:441–453@HEAD`.

5. **High — singleton-era importer merges account proofs and can lower counters.**  
   Concrete state: Redux profiles A and B contain proofs for the same mint/keyset, with counters 100 and 20. The importer saves both profiles into one manager and writes 100 then 20. `helper/coco/migration.ts:104–118,154–158@bab1c891f`; singleton database: `helper/coco/manager.ts:84–86@bab1c891f`. This establishes a failing persisted-state condition; prevalence in shipped installations is unverified.

For a direct pre-Coco upgrade, a further identity hazard exists: when only legacy `SOVRAN` storage exists, HEAD’s missing-root check inspects `profile-store`, then can generate a new root. It does not inspect the legacy envelope. `helper/redux/store/index.ts:353–361@a09fe2d54`; `app/shared/lib/nostr/secureStorage.ts:441–457@HEAD`.

### 4. Existing tests and gaps

All test references are at **HEAD**; none were run.

| Tests | Actual coverage |
|---|---|
| `app/__tests__/cashuCounterSafety.test.ts:77–123` | Monotonic updates, keyset isolation and concurrent calls using fake repositories; no real SQLite migration or restore-at-zero case. |
| `app/__tests__/keyDerivation.test.ts:60–138` | Current D64/index/imported derivation; no historical D32 vector. |
| `app/__tests__/loadAccountKeys.test.ts:173–182` | Explicitly accepts the derived-profile pubkey mismatch in finding 4. |
| `app/__tests__/cocoCleanupDuringInit.test.ts:93–241` | Initialization/reset races and captured account identity, with mocked SQLite. |
| `app/__tests__/cocoBackupLifecycle.test.ts:64–82` | Reset removes backup files; not backup creation, migration failure or historical DB preservation. |
| `app/__tests__/restoreKeysetGuards.test.ts:18–40,107–130` | Keyset selection and delegation to mocked Coco restore; not counter-zero behavior. |
| `app/__tests__/cocoRepositories.test.ts:45–63,111–201` | Repository forwarding/key handling; no released SQLite fixtures. |
| `app/__tests__/releaseUpgrade.test.ts:2–4,18–31,113–125` | Synthetic Zustand/AsyncStorage upgrades, including profiles; not Coco databases or Redux proofs/quotes. |
| `app/__tests__/cocoCoreUnmodified.test.ts:37–88` | Sanctioned patch boundaries; not historical persistence compatibility. |

**Unverified:** actual databases from SQLite 0.6.0, rc11/rc30/rc34/rc47 and scoped 1.0.x; proof/operation/counter equality after upgrade; interrupted/full-disk migrations; pre-Coco direct upgrades; D32 recovery; restore counter 0; multi-account singleton migration; iOS and Android upgrades.

**Negative searches:** searched HEAD’s `app/shared` for `SOVRAN`, `persist:root`, `migrateFromRedux`, Redux/legacy proof import paths, and inspected both migration registries. No legacy ecash importer found. Searched `app/__tests__` for `lastCounterWithSignature`, `persist:SOVRAN` and `coco_cashu_migrations`; no corresponding recovery or historical schema fixture coverage found.