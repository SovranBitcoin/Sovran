# Survey: stores and persistence (pass 0, "pin behaviour")

Area: `app/shared/stores` (global, profile, runtime), `app/shared/lib/persist`,
`app/shared/lib/migrations`, `app/shared/lib/account`, `app/shared/lib/backup`,
`app/shared/lib/cache`, `app/features/backup`, `app/shared/providers`.
Read-only. No test was run (none was essential; every claim below comes from reading the code).
Paths are relative to `app/` unless they start with `wallet/`, `docs/` or similar.

Summary: the persistence *library* (merge, unreadable guard, hydration outcome, migrations,
registry) is pinned more thoroughly than anything else in the app. The gaps are in
**provider lifecycles** (stage reset, Coco phase 2, the switch boundary) and in **writers that
do not respect the read schema's limits**. Two verified defects and one ordering defect follow
from that.

---

## 1. Boundaries

"Pinned" means a test checks behaviour a caller can see. "Internals" means the only tests mock
the module's collaborators so heavily that a refactor would break them without changing
behaviour.

### Persistence library

| # | Boundary | File | Used by | Pinned by |
|---|---|---|---|---|
| B1 | `persistConfig()`: version, identity migrate, schema merge, failed-save reporting, unreadable guard, profile write barrier wrap | `shared/lib/persist/persistConfig.ts:138` | every persisted store | `persistUnreadableGuard`, `persistRoundTrip`, `persistSchemaDrift`, `releaseUpgrade`, `hydrationOutcome` — **pinned** |
| B2 | `createMergeWithSchema` (whole-blob reject, `independentFields` keep-what-parses) | `shared/lib/persist/createMergeWithSchema.ts:21` | via B1 | `persistUnreadableGuard:310`, `settingsStorePersistResilience`, the `*PersistResilience` suites — **pinned** |
| B3 | `guardUnreadable` side copy `<store>:unreadable[:profile:<pk>]`, refusal after a failed read | `shared/lib/persist/preserveUnreadable.ts:43` | via B1 | `persistUnreadableGuard` (15 cases) — **pinned** through the real persist path |
| B4 | `tolerantRecord` / `tolerantArray` | `shared/lib/persist/tolerant.ts:80,101` | settings, swap, legacy ecash, routstr, others | `persistedEnumTolerance`, `persistSchemaDrift`, store suites — **pinned** |
| B5 | `defineStore` / `defineVanillaStore` → `liveStores` registry; write log | `shared/lib/persist/defineStore.ts:110` | every store | `storeRegistry`, `defineStoreWriteLog` — **pinned** |
| B6 | Profile write barrier: `blockProfilePersistWrites`, `withSkippedPersistWrites`, `profilePersistWrite`, `trackProfilePersistWrite` | `shared/lib/persist/profileWriteBarrier.ts` | in-process switch, hold, mock injections, routstr adapter | `inProcessProfileSwitch`, `profileScopedStorage`, `ownProfilePatch` — **pinned** |
| B7 | `hydrationSettled` / `loadRequiredStores` | `shared/lib/persist/hydrationOutcome.ts:30,53` | `migrateThenLoad` | `hydrationOutcome` (unit and real store) — **pinned** |
| B8 | `createSecureVault` (two-slot chunked SecureStore, `routstr_v1_<pk>_<sha>_manifest`) | `shared/lib/persist/secureVault.ts:17` | routstr secure persistence, removal, Delete All | `routstrSecureVault` (4 cases), `routstrSecurePersistence` — **pinned**. Not pinned: a crash between the "pending slot" manifest write and the chunk writes; the write queue's order when two writes interleave with a read |
| B9 | `fileCacheStorage` (large caches in a file) | `shared/lib/persist/fileCacheStorage.ts` | btc map cache | `fileCacheStorage` — **pinned** |
| B10 | `reportAsyncStorageUsage` | `shared/lib/persist/storageUsage.ts` | `TransitionGuardCleanup` | `storageUsage` — **pinned** |
| B11 | `storeRegistryManifest` (generated) / `declaredStores` / `persistedStoreKeys` | `shared/lib/persist/storeRegistryManifest.ts`, `shared/lib/account/accountRegistry.ts:54,57` | migrations, removal, Delete All | `storeRegistry`, `e2eStoreManifest`, `releasedPersistedSurface` — **pinned** |

### Migrations and account registry

| # | Boundary | File | Used by | Pinned by |
|---|---|---|---|---|
| B12 | `runGlobalMigrations` (marker `global-migrations-completed`; four migrations; `RUN_AGAIN`) | `shared/lib/migrations/globalMigrations.ts:587` | `migrateThenLoad` | `globalMigrationsRunner`, `preProfileUpgrade`, `lifecycleStampMigration`, `themeMigration`, `releaseFixtures*` — **pinned** |
| B13 | `migrateThenLoad` (migrations, then reload profile/settings/lifecycle) | `shared/lib/migrations/migrateThenLoad.ts:25` | `GlobalMigrationGate` | `migrateThenLoad` — **pinned** |
| B14 | `runDataMigrations` (per-profile level in `data-migration-store`) | `shared/lib/migrations/dataMigrations.ts:53` | `features/send/providers/Colada.tsx:529` (fire and forget) | `dataMigrations` (7 cases) — **pinned** |
| B15 | Holder/service/boundary registries, quiescing flag | `shared/lib/account/accountRegistry.ts:85,103,117,133` | NDK provider, caches, `AccountSwitchBoundary`, in-process switch, removal | `storeRegistry`, `inProcessProfileSwitch` — **pinned** for registration; `AccountSwitchBoundary` itself has **NONE** |

### Global stores (AsyncStorage bare key)

| # | Boundary | File | Pinned by |
|---|---|---|---|
| B16 | `profile-store`: `addProfile`, `switchProfile`, `getNextAccountIndex`, `repairDerivedSource`, `recordWalletPhraseFingerprint`, `setWalletDatabaseCreated`, `updateProfileBalance/Metadata`, `afterHydrate` active-index repair, v1→v2 migrate | `shared/stores/global/profileStore.ts:206` | `profileStorePersistResilience`, `profileStoreCapacity`, `profileStoreActiveSelector`, `profileWalletPhraseFingerprint`, `releaseFixtures` — **pinned** for load. Actions: `setWalletDatabaseCreated` only in `removeProfile` (mocked context); `getNextAccountIndex` with imported rows mixed in only in `accountIntegrityBoundaries`; `updateProfileMetadata` clearing the name when called with `undefined` is **unpinned** |
| B17 | `settings-store` (v4 migrate: mock and dev flags forced off, `hasSeenOnboarding` inferred), `acceptLegalDocuments`, `useSettingsHydration` status | `shared/stores/global/settingsStore.ts:322` | `settingsStorePersistResilience`, `migrateThenLoad`, `appGateReinstallDetection` — **pinned**. `completeOnboarding`, `setMiddlemanRouting` (partial merge), `setPrimalHostEnabled` have no test (**unpinned**, low risk) |
| B18 | `wallet-lifecycle`: `restoreStatus`, `seedCreatedAt`, `markRestoreComplete`, `markRecoveryPhraseVerified`, `useWalletLifecycleHydrated` | `shared/stores/global/walletLifecycleStore.ts:50` | `lifecycleStampMigration`, `migrateThenLoad`, `awaitRestoreReady`, `settingsRecoveryGateConfirmation`, `ctaHost` — **pinned** for load and gate. `markRestoreComplete` has no direct test (reached only through the gate test) |
| B19 | `legacy-ecash-store` + `legacyEcashRecordsSaved()` read-back | `shared/stores/global/legacyEcashStore.ts:82,101` | `legacyEcashClaim` (real store over mocked AsyncStorage, including a failing save at :649) — **pinned** |
| B20 | `cta-store` dismissals | `shared/stores/global/ctaStore.ts:22` | `ctaPersistence`, `ctaHost` — **pinned** |
| B21 | Caches: `mint-metadata`, `nostr-metadata-cache`, `relay-metadata`, `mempool-address-cache`, `btc-map`, `pricelist`, `mint-testnut`, `wallpaper` | `shared/stores/global/*` | their own suites (`mintMetadataStore`, `nostrMetadataCache*`, `relayMetadataStore`, `mintTestnutStore`, `pricelistProviderWiring`) — **pinned** for the main paths; refetchable data |

### Profile stores (`<store>:profile:<pubkey>`)

| # | Boundary | File | Pinned by |
|---|---|---|---|
| B22 | `nut-drop-redeem-queue` (bearer and P2PK tokens awaiting redemption) | `shared/stores/profile/nutDropRedeemQueueStore.ts:165` | `nutDropRedeemQueueStore` (6 cases), `dmEcashIntake`, `dmEcashRecovery` — **pinned** for actions. **Unpinned**: an over-limit entry costs the whole queue on the next launch (see D2) |
| B23 | `swap-transactions-store` (groups, legs, quote index) | `shared/stores/profile/swapTransactionsStore.ts:165` | `swapTransactionsStoreLegPatch`, `reconcileSwapLegs`, `swapTransactionsStorePersistResilience` — **pinned** |
| B24 | `mint-store` (selected mint, active unit, standing quotes, receive mint by method, creq lock and exclusions; v1→v2) | `shared/stores/profile/mintStore.ts:109` | `mintStoreActiveUnit`, `releaseUpgrade` — **pinned** for unit and load; `standingQuotes` and `receiveMintByMethod` actions **unpinned** |
| B25 | `routstr-store` (secrets moved to the vault, sessions, pending payments) | `shared/stores/profile/routstrStore.ts` | `routstrSecurePersistence`, `routstrStorePersistResilience`, `persistedCapacity`, `routstrAccountArchive` — **pinned** |
| B26 | `data-migration-store` level | `shared/stores/profile/dataMigrationStore.ts:33` | `dataMigrations` — **pinned** |
| B27 | Remaining profile stores (annotation, distribution, location, scan history, search history, recent people, DM last message, theme, own content, owned media, own profile metadata, vertex budget, AI directory, npc mint, send reachability, mint distribution, nostr social) | `shared/stores/profile/*` | each has a store or resilience suite (`transactionAnnotationStorePersistResilience`, `themeStoreMigrate`, `nostrSocialStore*`, `mintDistributionStorePersistResilience`, etc.) — **pinned** for load; their actions vary |

### Runtime (session) stores

| # | Boundary | File | Pinned by |
|---|---|---|---|
| B28 | `clearPaymentContext(reason)`: routstr top-up, near pay, contact send, amount draft, send lock, pending zaps, nutzap cache | `shared/stores/runtime/clearPaymentContext.ts:27` | `clearPaymentContext`, `paymentRootContext` — **pinned** |
| B29 | `paymentStatusStore`, `pendingZapStore`, `dmEchoStore`, `amountDraftStore`, `nearPayStore`, `popupStore`, `sendLockStore`, `swapStatusStore` | `shared/stores/runtime/*` | own suites — **pinned** |
| B30 | `useSecureStoreState` (locked keychain) | `shared/stores/runtime/secureStoreState.ts:4` | through `KeyRecoveryScreen` and keys provider tests — **pinned** indirectly |

### Caches

| # | Boundary | File | Pinned by |
|---|---|---|---|
| B31 | `createQueryCacheStore`, `clearAllQueryCaches` | `shared/lib/cache/createQueryCacheStore.ts` | `createQueryCacheStoreGenerations`, `useCachedRead*` — **pinned** |
| B32 | `createPubkeyScopedCache` (NIP-04 and NIP-17 plaintext caches `nip04-cache:v1:<pk>` etc.), `removePlaintextCaches` | `shared/lib/cache/createPubkeyScopedCache.ts:49,45` | `profileRemovalCaches` (removal only) — hydrate, put, eviction and flush are **unpinned** |
| B33 | `currentCacheEpoch` (bumped by the account-scoped dispose) | `shared/lib/cache/cacheSession.ts:19` | **NONE** |

### Providers

| # | Boundary | File | Pinned by |
|---|---|---|---|
| B34 | `InitializationProvider` stages: `registerStage`, `canStageStart`, `resetStages({keepStagesThatOutliveAccount})`, `cancelResetStages`, `isInitializing` | `shared/providers/InitializationProvider.tsx:125-330` | `initializationStagesAcrossSwitch` (2 cases: in-process switch, restart reset), `initializationGateRetry`. **Unpinned**: a reset followed by `cancelResetStages` while the account providers stay mounted (see D1) |
| B35 | `NostrKeysProvider`: startup key load, integrity stop, on-demand `getKeysForAccount` | `shared/providers/NostrKeysProvider.tsx:86` | `accountIntegrityStartup`, `nostrKeysImportedFallback`, `loadAccountKeys` — **pinned** |
| B36 | `CocoProvider` phase 1 (open, retry with re-staged credentials) | `shared/providers/CocoProvider.tsx:255` | `cocoProviderRetry` (1 case) — **pinned** for retry |
| B37 | `CocoProvider` phase 2: safe watchers → default mints → await restore → NPC sync → send/melt/receive recovery → payment-request recovery → Routstr recovery, SDK sweep, reclaim → legacy ecash claim | `shared/providers/CocoProvider.tsx:122-212` | **NONE** (the retry test mocks all of it out) |
| B38 | `awaitRestoreReady` | `shared/providers/awaitRestoreReady.ts:25` | `awaitRestoreReady` — **pinned** |
| B39 | `AccountScopedProviders` order, `AccountSwitchBoundary` suspend/resume, `TransitionGuardCleanup` | `shared/providers/AccountProviders.tsx:42,117,182` | **NONE** (order is described in docs only; boundary reached only through the mocked `inProcessProfileSwitch`) |
| B40 | `WalletContextProvider` (balances by unit, proof amounts, unit synced to the selected mint) | `shared/providers/WalletContextProvider.tsx:67` | `walletContextProofAmounts` — **pinned** for proof amounts; the unit-sync effect (:140-175) is **unpinned** |
| B41 | `OfflineProvider`, `NostrNDKProvider`, `BitchatBLEProvider`, `PricelistProvider`, `NostrSignerProvider` | `shared/providers/*` | `offlineProviderLifecycle`, `nostrNdkInitialization`, `bitchatBleProviderStartup`, `pricelistProviderWiring` — **pinned**; `ThemeProvider`, `BackgroundProvider`, `HeroTransitionProvider` **NONE** (presentation only) |

### Backup

| # | Boundary | File | Pinned by |
|---|---|---|---|
| B42 | Backup flow: `BackupFlowProvider` session, `buildVerifyPlan`, `advanceVerify`, done screen marks `recoveryPhraseVerified*` once (not in demo) | `features/backup/*`, `shared/lib/backup/revision.ts` | `backupFlow`, `backupVerifyPlan` — **pinned** |

**Counts:** 42 boundaries. 31 pinned for their main behaviour, 6 partly pinned (B8, B16, B22,
B24, B32, B34), 5 with no test at all (B33, B37, B39, B41 for theme/background/hero, plus the
`AccountSwitchBoundary` part of B15).

---

## 2. Notes on how strong the pins are

- The persist library tests run through the real zustand persist path over a mock disk
  (`persistUnreadableGuard`, `hydrationOutcome`, `releaseUpgrade`). A refactor of
  `persistConfig` that keeps the behaviour keeps them green. Good characterization tests.
- `profileSwitchOrdering` and `profileTransitionLock` pass `resetStages`/`cancelResetStages` as
  `jest.fn()`. They prove the orchestrator *calls* them; nothing proves that the app is usable
  after a flow gives up. This is the gap behind D1.
- `cocoProviderRetry` mocks `CocoManager`, recovery, Routstr, mint metadata and the stage. It
  pins one behaviour (credentials re-staged before a retry) and nothing about phase 2.
- `removeProfile` drives `setWalletDatabaseCreated` with mocks around it; the action's own
  "no write when nothing changes" rule (`profileStore.ts:329`) is not asserted.

---

## 3. Likely surgery targets

1. **Initialization stages as an implicit lifecycle.** `InitializationProvider.tsx:125`
   (`stages` Map), `:130` (`awaitingStages`), `:255` (`resetStages` with
   `keepStagesThatOutliveAccount`), `:274` (`cancelResetStages`), per-hook `hasRegistered` ref
   `:327`, `canStageStart` returning false for an unregistered stage `:203`. Together these
   encode {booting, ready, transitioning-to-restart, transitioning-in-process, given-back,
   failed}, and "given-back" has no real representation (D1). Pinned:
   `initializationStagesAcrossSwitch` covers two transitions. Not pinned: reset + cancel with
   providers mounted, a stage error followed by `log` (error → loading, which the Coco retry
   relies on), the splash's `isInitializing` when the map is empty.
2. **Coco phase 2 as a hand-rolled sequence.** `CocoProvider.tsx:122-212`: about eleven awaited
   steps, each guarded by `isLive()`, with one try/catch for five independent recoveries
   (`:146-196`). Candidate for a list of named, independently failing steps. **Not pinned at
   all** (B37).
3. **`guardUnreadable` closure state.** `preserveUnreadable.ts:49-55`: `raw`, `readFailed`,
   `rejected`, `preserving`, `refusalLogged` and `generation` jointly encode {unread, loaded,
   read-failed, rejected-unpreserved, rejected-preserving, rejected-preserved}. Well pinned by
   `persistUnreadableGuard`; safe to make explicit.
4. **`walletLifecycleStore` restore status.** `walletLifecycleStore.ts:9,42`: six statuses, of
   which nothing writes `in-progress` or `failed` any more (AppGate `:276-281` treats them as
   unresolved; `walletDatabaseRecord.ts:45` still reads `failed`). `seedCreatedAt`,
   `restoreStatus`, `lastRestoreAt` and `lastRestoreError` together encode the restore phase.
   Pinned for load and gate (`lifecycleStampMigration`, `settingsRecoveryGateConfirmation`).
   Changing the enum is a persisted-schema change (keep `.catch('unknown')`).
5. **Nut Drop queue entry.** `nutDropRedeemQueueStore.ts:25-58`: `status`, `attempts`,
   `nextAttemptAt` and `lastError` encode the retry phase; `scheduleRetry` returns the entry to
   `pending` with a backoff, `requeue` resets attempts. Actions pinned; the read schema is a
   plain `z.record` (one bad entry costs the queue), and the limits are enforced by one of the
   two writers only (D2).
6. **Duplicated LRU policy.** `createPubkeyScopedCache.ts:128-135` keeps a private `evictLRU`
   that evicts `floor(max*0.1)` and not at least the overflow, while
   `shared/lib/cache/evictLruOverCap.ts:16` says it is the one definition. The private copy also
   never evicts after `hydrate` loads more than `maxEntries`. **Unpinned** (B32).
7. **`AccountSwitchBoundary` acknowledgement handshake.** `AccountProviders.tsx:117-162`:
   `suspended` state, `suspendedRef`, `suspending` promise and an `acknowledgement` ref. A
   `resume()` while not suspended sets the same state, so the effect never runs and the promise
   never settles (the in-process switch's five-second timeout hides it). **Unpinned**.
8. **CTA presentation state.** `ctaStore.ts:9-21`: `activeId`, `closingId`, `previewOverride`
   and `previewSeq` encode {idle, showing, closing, previewing}. Only `dismissed` is saved.
   Pinned for dismissals (`ctaPersistence`) and host (`ctaHost`).
9. **`NostrKeysProvider` status.** `NostrKeysProvider.tsx:94-98`: `keys`, `cashuMnemonic`,
   `isReady`, `isLoading` and `error` plus `hasStarted` encode {waiting, loading, ready,
   failed}. `getKeysForAccount` (`:227`) and `getCashuMnemonicForAccount` (`:239`) write
   `error` on an on-demand failure and nothing clears it, so `error` and `isReady` can both be
   set. Harmless today (render checks `error && !isReady`); a refactor that reads `error` alone
   would show the recovery screen on a working account. Startup pinned; the on-demand error is
   not.
10. **Settings store shape.** `settingsStore.ts:47-114`: about 30 flat fields, about 25
    one-line setters with the same log-and-set body, and a `migrate` that re-runs the developer
    reset on every version bump (`:486-524`, its comment warns about this). A shallow module
    with an interface as wide as its state. Load pinned (`settingsStorePersistResilience`);
    most setters are not, but they are trivial.

---

## 4. Obvious defects

### D1. A flow that gives up after taking the splash closes the wallet and leaves the app blank

- **Where:** `shared/lib/profile/profileTransition.ts:240-249` (`holdSplash` → `resetStages`,
  `release` → `cancelResetStages`), `shared/providers/InitializationProvider.tsx:203,255-276,327`,
  `shared/providers/CocoProvider.tsx:255-287`.
- **Trigger:** any give-up exit after `holdSplash`:
  - `createAndSwitchProfile`: key derivation fails or times out, the integrity check refuses, or
    the list is at `MAX_PROFILES` (`profileSessionOrchestrator.ts:302-331`);
  - `importAndSwitchProfile`: the keychain refuses the key (`'key-not-stored'`) or the list is
    full (`:398-409`);
  - `deleteAllProfiles` fails before erasing starts (`:603` onward);
  - `switchToExistingProfile`: the target does not exist (`:148-158`).
- **What happens:** `resetStages()` empties the stage map (in default mode it keeps nothing,
  and even with `keep` the account stages `nostr`/`coco` go). The mounted account providers
  registered once (`hasRegistered`) and never register again, so `canStageStart('coco')` is now
  false. That changes the memoised `stage` object, so CocoProvider's phase-1 effect cleans up:
  `setIsReady(false)` and `CocoManager.cleanup()`. The effect then runs again, sees
  `!stage.canStart` and returns. `release()` → `cancelResetStages()` only clears
  `awaitingStages`. The map stays empty, CocoProvider renders `null`, and everything under it
  (wallet context, Colada, AppGate, the routes) is gone until the app is killed. The docs say
  the opposite: "the lock and splash are released and the app carries on as A"
  (`docs/architecture/account-lifecycle.md:150-151`). There is no hold alert, because the
  orchestrator believes it gave the app back.
- **Should:** a give-up before the point of no return leaves the stages (and therefore the
  wallet) as they were. For example, take a snapshot in `resetStages` and restore it in
  `cancelResetStages`, or move `holdSplash` after the last refusable check, as
  `switchToExistingProfile` already does for its integrity check (`:136-147`).
- **Verified:** by reading the full path; not executed. The memo dependency on `canStart`
  (`InitializationProvider.tsx` `useInitializationStage` return) and the cleanup body are both
  plain. `initializationStagesAcrossSwitch.test.tsx:79-92` already shows the "nothing registers
  again" half.
- **Touches stored data / migration / wire format:** no. Not recorded in `docs/follow-ups`.

### D2. A Nut Drop token received over Bluetooth can cost the whole redeem queue on the next launch

- **Where:** `features/nearPay/hooks/useNutDropAutoRedeem.ts:113-119` enqueues without checking
  `NUT_DROP_QUEUE_LIMITS`. The DM path does check them
  (`features/payments/lib/dmEcashIntake.ts:111-114`). The read schema
  `shared/stores/profile/nutDropRedeemQueueStore.ts:128-159` is a plain `z.record` with
  `mintUrl.max(2048)`, `unit.max(16)`, `token.max(60_000)`, `senderPeerID.max(128)`, and the
  store says a writer must check them (`:111-115`).
- **Trigger:** a nearby BitChat peer sends a private message whose whole content is a cashu
  token that `classifyMeshToken` accepts (proofs present, amounts readable). The token carries
  a mint URL over 2048 characters, or a unit over 16 (`wallet/src/transport/classify.ts:99-100`
  takes both verbatim, with no length check), or is itself over 60,000 characters.
- **What happens:** the entry is saved. On the next launch the schema rejects the blob, the
  queue loads empty, and every other queued token (pending, untrusted-mint, failed: real
  money) disappears from the drainer. The bytes survive only as
  `nut-drop-redeem-queue:unreadable:profile:<pubkey>`, which nothing reads.
- **Should:** the BLE writer refuses what the store cannot read back, as `dmEcashIntake` does
  (best done once inside `enqueue`). The entry schema could also be contained per entry with
  `tolerantRecord`.
- **Verified:** writer and schema read end to end; the attack input was not executed.
- **Touches stored data:** a writer-side check, no. Making the read schema tolerant is a
  persisted-schema change: report only (it would recover queues already set aside, so it is
  worth the `persistence-release-safety` pass).

### D3. One failing wallet recovery skips the Routstr change recovery that has a deadline

- **Where:** `shared/providers/CocoProvider.tsx:146-196`.
- **Trigger:** `chainManager.ops.send.recovery.run()` or the melt or receive recovery throws.
  Coco's `recoverPendingOperations` throws on "Recovery is already in progress" and does not
  catch a failing `recoverInitOperation` (`node_modules/@cashu/coco-core/dist/index.js:5750,5762-5765`
  for send, `:6381,6393-6396` for melt).
- **What happens:** all of these sit in one try. A throw at send recovery skips melt and
  receive recovery, the NUT-18 sweep, `recoverPendingPayments`, `sweepUnsettledPayments` and
  `reclaimRoutstrBalances` for this launch. The comment at `:173-175` says Routstr change
  recovery "Runs first: it is the only one with a deadline (a node sweeps unclaimed refunds
  eventually)", but it runs fifth.
- **Should:** each recovery fails on its own, and the deadline-bound one runs first, as its
  comment says.
- **Verified:** ordering and the shared try, yes. How often send recovery throws in practice is
  UNVERIFIED.
- **Touches stored data:** no.

### Checked and not defects (so later passes do not re-chase them)

- `profileStore` `source: z.enum(...).catch('imported').optional()`: a *missing* `source`
  parses as absent (checked against zod 4.4.3), so derived rows stay derived.
- `walletLifecycleStore` `lastRestoreError.max(500)` without `.catch`: no current writer passes
  an error (`setRestoreStatus` callers pass a status only), so not reachable today. It becomes
  a whole-blob reject (losing `seedCreatedAt`) the moment someone does.
- `settingsStore` `primalHostsDisabled` capped at 16 on read with no cap on write: only
  reachable with more than 16 configured Primal hosts; the field then resets alone
  (`independentFields`).
- `swapTransactionsStore` `errorMessage.max(2048)` with no clip: writers pass catalogue text
  (`describeError(...).text`) or a constant; not shown reachable.

---

## 5. Proposed characterization tests (ranked)

1. **Give-up keeps the wallet open** (D1). Real `InitializationProvider`, a stub
   `AccountScoped` child that uses `useInitializationStage('coco', {dependsOn:['nostr']})` and
   counts effect cleanups, and a real `acquireTransition()` lock. `holdSplash` then `release`
   with no remount. Pin: `canStart` is true again, the stub's cleanup did not run,
   `isInitializing` is false. Also pin today's restart path (`resetStages()` without cancel →
   dependants wait). File: `app/__tests__/initializationStagesAcrossSwitch.test.tsx` (extend).
   Fails against today's code. After the fix, it fails if `cancelResetStages` stops restoring
   the snapshot.
2. **Coco phase 2 order and isolation** (B37, D3). Render `CocoProvider` with a fake manager
   whose recoveries record calls; make `send.recovery.run` reject. Pin the step order (watchers
   → default mints → restore wait → NPC sync → recoveries → legacy claim), that nothing past the
   restore wait runs while `restoreStatus` is `pending` (QUIRK: default mints and safe watchers
   do run), that a stale manager (`peekInstance()` changed) stops the chain, and which
   recoveries run after a failure. File: `app/__tests__/cocoProviderPhase2.test.tsx`. Breaks
   if a step is reordered or the restore wait is removed.
3. **Redeem queue survives an oversize entry** (D2). Through the real persist path over a mock
   disk: enqueue from the BLE listener a token with a 3000-character mint and another normal
   token, then rehydrate. Pin today's QUIRK (whole queue empty, side copy written) and, after
   the fix, refusal at enqueue. File: `app/__tests__/nutDropRedeemQueueStore.test.ts`. Breaks if
   the limit check is removed from `enqueue`/the listener.
4. **`AccountSwitchBoundary` handshake** (B39). Render it with a registered boundary; pin that
   suspend resolves after children unmount, a second suspend joins the first, resume remounts
   and resets navigation once, and (QUIRK) resume without a prior suspend never settles. File:
   `app/__tests__/accountSwitchBoundary.test.tsx`. Breaks if the acknowledgement is resolved
   before the commit.
5. **Profile store actions** (B16). Pin: `addProfile` true for the same index and key, false
   for the same index with another key, false at 64; imported rows get `externalChain: 1`;
   `getNextAccountIndex` ignores imported indexes; `setWalletDatabaseCreated` does not write
   when nothing changes (spy on `setItem`); `updateProfileMetadata(i)` with no arguments clears
   the cached name and picture (QUIRK); `recordWalletPhraseFingerprint` never replaces one.
   File: `app/__tests__/profileStoreActions.test.ts`. Breaks if the duplicate check compares
   the index only.
6. **Wallet lifecycle transitions** (B18). Pin: `markSeedCreatedNow` writes once;
   `markRestoreComplete` clears the error and stamps `lastRestoreAt`; a persisted `in-progress`
   or `failed` is sent to `pending`/`not-needed` by `RestoreGate` depending on `seedCreatedAt`;
   `awaitRestoreReady` resolves for `complete` and `not-needed` only. File:
   `app/__tests__/walletLifecycleTransitions.test.ts`. Breaks if a status value is dropped
   from the enum or the gate's mapping changes.
7. **Pubkey-scoped cache** (B32). Pin: hydrate adopts valid entries and skips invalid ones; a
   `put` before `hydrate` is overwritten by the disk value (QUIRK); eviction at `maxEntries+1`
   removes 10%; a failed flush stays dirty and retries; `removePlaintextCaches` waits for
   pending flushes. File: `app/__tests__/pubkeyScopedCache.test.ts`. Breaks if eviction is
   swapped for `evictLruOverCap` without accepting the at-least-overflow change.
8. **Settings setters and migrate** (B17). Pin that a v3 blob with every developer flag on
   lands with all of them off and the rest kept; that a v4 blob does not re-run the reset
   (QUIRK the comment depends on); that `setMiddlemanRouting` merges partially;
   `setPrimalHostEnabled` toggles without duplicates. File:
   `app/__tests__/settingsStorePersistResilience.test.ts` (extend). Breaks if `version` is
   bumped without guarding the dev reset.

---

## 6. Not examined

- `stores/profile/routstrStore.ts` beyond its schema and bounding helpers (lines 1-700 and
  900-1852 were not read in full); `stores/profile/nostrSocialStore.ts`,
  `mintDistributionStore.ts`, `ownContentStore.ts`, `ownedMediaStore.ts`,
  `aiProviderDirectoryStore.ts`, `vertexBudgetStore.ts`, `sendReachabilityStore.ts`,
  `searchHistoryStore.ts`, `recentPeopleStore.ts`, `scanHistoryStore.ts`,
  `transactionAnnotationStore.ts` and their action logic (only their test coverage was
  checked).
- Global caches `mintMetadataStore.ts`, `nostrMetadataCache.ts`, `relayMetadataStore.ts`,
  `btcMapStore.ts`, `mempoolAddressCache.ts`, `wallpaperStore.ts`, `pricelistStore.ts`,
  `mintTestnutStore.ts`.
- `shared/lib/cache/createQueryCacheStore.ts`, `fileCacheStorage.ts`, `storageUsage.ts` bodies.
- Runtime stores `mockDataStore.ts` (and `purgeLegacyMockData`), `legProgress.ts`,
  `paymentStatusStore.ts`, `popupStore.ts`, `nearPayStore.ts`, `pendingZapStore.ts`; the
  `fixtures/publicDemoSnapshot.json`.
- Providers `OfflineProvider.tsx`, `BackgroundProvider.tsx`, `NostrNDKProvider.tsx`,
  `ThemeProvider.tsx`, `BitchatBLEProvider.tsx`, `PricelistProvider.tsx`,
  `NostrSignerProvider.tsx`, `hero-transition/*` (outlined only); the rest of
  `WalletContextProvider.tsx` after line 260.
- Backup screens other than Done and the navigation lines of Verify.
- `shared/lib/cashu/profileScopedStorage.ts`, `shared/lib/profile/*` and `AppGate.tsx` were
  read only where they meet this area.
