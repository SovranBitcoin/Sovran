# Startup, accounts and providers — pass 2

Surveyed checkout: `sovran-surgery`, HEAD `26ef519bc5d5c77fa574b6e23a535b1cff5a807b`. Product code unchanged. Started from pass 0 `settings-onboarding-routes.md` and startup sections of `stores-persistence.md`, then checked the current code and `.surgery/LEDGER.md`. Paths below are checkout-relative; `A/` means `app/`. Line ranges identify participating implementations, not just declarations. Consumer counts describe the named phase's direct owners/readers, not every transitive context consumer.

Evidence: **traced** means followed code, not executed. **Run:** `cd app && bun run test -- initializationGiveUp.test.tsx --runInBand`: 1 suite, 3 tests passed, including the test that reproduces the blank app after give-up. No other tests run; tests named below were located/read for their coverage, not claimed green. No native, network, funded-wallet, full-suite or saved-check runs. The newer ledger pins materially more than pass 0 did.

Ranked by reachable bad states and money/saved-data consequences relative to conversion cost. A representation admitting a combination does not establish that a user can reach it. Preserve every persisted key, version and field; proposed unions are runtime views decoded at read boundaries. `wallet/src/machine` is the existing machine precedent; use a local reducer for synchronous state, an owned async run for cancellation/deadlines, not a new dependency.

## 1. Recovery run, cancellation and irreversible finalization — convert, M

**Files:** `A/features/settings/screens/SettingsRecoveryScreen.tsx:70-88,145-608,634-1055`; `A/features/settings/lib/recoveryProgress.ts:1-201` (phase, row types and counts); `A/shared/lib/cashu/managerInternals.ts:248-250` (`deleteMintOperation`); `wallet/src/safeFetch.ts:157-185` (timeout race).

**Encoding:** module `recoveryInFlight/recoveryCancelled`; local `phase`, `results`, `errorMessage`, `finalizingLabel`, `deepProbe`, discovered URLs and `isDiscovering`; mutable `recoveryResults` copied into React state; per-keyset failure/skipped/already-recovered counters; slider completion state.

**States/events:** idle → discovering/probing → restoring mint/keyset → stopping/draining → finalizing → complete/partial/failed → retry; request cancel, timeout, keyset result, cleanup result and user Continue are separate events. Today there is no draining state or run identity.

**Meaningless combinations:** terminal run with active restore; idle remount with a globally owned run; done row whose work was cancelled; cleanup-authorized with failed/unvisited keysets; complete with no successful row and disabled Continue. **Reachability traced:** F178 covers timeout overlap, late row writes and dead ends; do not file again. Separately, `handleStartRecovery` proceeds through lines 475-539 after failed keysets or cancellation and deletes *all* pending mint operations, before checking cancellation/failures at 557-580. See D1. Module single-flight prevents an ordinary second start, but not F178's timeout orphan.

**Persistence:** run state is transient; restore writes Coco proofs/counters, mint trust and operation rows. Startup authorization lives separately in `wallet-lifecycle.restoreStatus`; settings recovery deliberately does not change it. Keep both disk representations. Model per-mint coverage before authorizing cleanup, rather than infer coverage from phase.

**Consumers:** three direct owners/readers: screen, recovery progress helpers, AppGate's completion callback. Screen rendering and navigation guard consume the same phase in several branches.

**Pins:** `settingsRecoveryGateConfirmation.test.tsx`, `settingsRecoveryRun.test.tsx`, `recoveryProgress.test.ts`; newer run tests explicitly pin timeout late writes and reswipe. Before conversion: cancellation during each await, remount while running, cleanup after failed/partial coverage, late completion after timeout, no-mints retry with the real slider.

**Delete:** two module flags, duplicate mutable/render results, unrestricted partial row patches, scattered active-phase/navigation checks and timeout ownership. One run object owns manager, epoch, rows, cancellation and settlement. Do not release it before started work drains.

## 2. Initialization reset / give-up / provider registration — convert, M

**Files:** `A/shared/providers/InitializationProvider.tsx:124-395`; `A/shared/lib/profile/profileTransition.ts:204-261`; `A/shared/providers/CocoProvider.tsx:258-291`; `A/shared/providers/AccountProviders.tsx:164-170`; `A/shared/blocks/NativeSplashLayoutGate.tsx:124-180`; `A/app/_layout.tsx:320-348`.

**Encoding:** stages map, `awaitingStages`, per-hook `hasRegistered`, stage-start-time map, held splash and cancellation callback. States should be booting, live, held-for-restart, held-for-remount, restoring-previous-session, failed. Events: register/start/finish/fail stage, begin transition, commit remount, abort transition.

**Illegal:** live/initialization-false with no registered stages while the original providers remain mounted. **Run:** F175, via reset → cancel without remount. `cancelResetStages` clears only `awaitingStages`; registration refs stay true. Coco's dependency permission changes and cleanup closes it. The executed `initializationGiveUp` test demonstrates exactly this. The same file also proves remount recovers. This updates evidence strength, not the scope of F175.

**Persistence:** none for stage state; disk transition guard is separate (`profile-transition-in-progress.startedAt`). No saved-shape change needed.

**Consumers:** five stage owners (GlobalMigrationGate through InitializationGate, NostrKeysProvider, Coco phase 1, Coco phase 2, NostrNDKProvider), plus NativeSplashLayoutGate and transition controls. Stage registration is per component, not per generation.

**Pins:** `initializationGiveUp.test.tsx`, `initializationStagesAcrossSwitch.test.tsx`, `initializationGateRetry.test.tsx`, `cocoProviderRetry.test.tsx`. Need composed aborts for create/import/delete/switch, not just injected reset controls.

**Delete:** independent hold flag, once-ever registration assumptions and distributed reset restoration. Reducer with a transition generation and explicit abort restoring the prior live stage set; preserve long-lived migration stage deliberately.

## 3. Restore eligibility versus safe-to-mint readiness — convert, M

**Files:** `A/shared/blocks/AppGate.tsx:224-319`; `A/shared/stores/global/walletLifecycleStore.ts:9-120`; `A/shared/providers/awaitRestoreReady.ts:1-43`; `A/shared/providers/CocoProvider.tsx:136-144`; `A/shared/lib/profile/profileSessionOrchestrator.ts:500-568`.

**Encoding:** hydrated, evaluated, seed timestamp, six restore statuses, last restore timestamp/error. States: unread, checking, locally-created, restore-required, interrupted legacy run, restore-confirmed, read-failed. Events: hydration, mnemonic read, recovery/import, user Continue. Historical `in-progress` is decoded on boot; settings recovery no longer writes it.

**Illegal:** evaluated=true with unresolved unknown/in-progress yet children rendered, while `awaitRestoreReady` still blocks processors; completed with arbitrary failure text is permitted by the generic setter. **Traced:** evaluate's `finally` always marks evaluated; a rejected mnemonic read has no catch, leaving unknown and allowing children, whereas the processor wait requires complete/not-needed. This is a rejection-path trace, not evidence the native keychain currently throws through `retrieveMnemonic` in this situation. No new defect asserted without that boundary proof. Ordinary boot with a created seed and terminal saved statuses avoids it. Old in-progress records are explicitly supported.

**Persistence:** global `wallet-lifecycle`: `seedCreatedAt`, `restoreStatus`, `lastRestoreAt`, `lastRestoreError`, verification timestamp/revision. Keep all, including legacy enum values, and decode runtime variants. Last-success timestamp on a later pending state can legitimately be history, not contradiction.

**Consumers:** three startup read sites: reinstall probe, RestoreGate, awaitRestoreReady; CtaHost additionally reads lifecycle for reminders. Other payment eligibility consumers also read restoreStatus; conversion should export a shared predicate, not silently rewrite their policy.

**Pins:** `walletLifecycleTransitions.test.ts`, `appGateOrder.test.tsx`, `restoreGateStatusResolution.test.ts`, `awaitRestoreReady.test.ts`, `releaseFixtureRestoreInFlight.test.ts`. Need real RestoreGate keychain-null/rejection and repeated hydration tests; old mirror-logic tests alone are insufficient.

**Delete:** local evaluated boolean, duplicate six-value status declaration, repeated readiness predicates. F77 already covers the uncancelled restore subscription; fold abort ownership into candidate 6.

## 4. Account transition protocol across React, storage and restart — convert, M

**Files:** `A/shared/lib/profile/profileTransition.ts:31-84,121-164,168-261`; `A/shared/lib/profile/profileSessionOrchestrator.ts:105-339,376-435`; `A/shared/lib/profile/inProcessProfileSwitch.ts:17-89`; `A/shared/providers/AccountProviders.tsx:117-161`.

**Encoding:** global in-flight flag, lock-local diskGuardTaken/splashHeld/cancelSplash, active index in memory versus on disk, quiescing flag, write barrier, boundary suspended state, and control flow position. States: admitted, validating, covered, stopping, stores-cleared, target-recorded, hydrating, resumed, restart-required, released. Events are step settlement/failure/timeout and restart acceptance.

**Illegal:** released admission while old work remains; partial target activation with providers live; abort advertised after previous session was dismantled. **Traced:** F175 is the abort case. Timed-out switch steps keep running because switchStep races without cancellation; fallback holds the boundary, restores previous memory index and requests restart. Thus pending work with restart-required is reachable, but is not itself proof of cross-account corruption. The write barrier, captured holders and fail-closed fallback protect the ordinary sequence. Test late completions before declaring safety.

**Persistence:** `profile-transition-in-progress.startedAt`, `profile-store.activeAccountIndex/profiles`; no persisted phase journal. Keep keys/fields; runtime transition discriminant can wrap existing writes. Adding a durable journal is separate scope/decision.

**Consumers:** four protocol files above; boundary state is encapsulated, orchestration owns sequencing. Public bools conflate success, restart request and held outcomes; imported-profile result is already more explicit.

**Pins:** `profileTransitionLock.test.ts`, `profileSwitchOrdering.test.ts`, `inProcessProfileSwitch.test.ts`, `profileSwitchResource.test.ts`, `profileStoreSideWriters.test.ts`. Need timeout then late completion at each step, and actual boundary/stage provider integration.

**Delete:** repeated lock acquisition/release exits and implicit point-of-no-return reasoning; use an owned transition with typed endings and explicit step timeouts. Do not replace existing disposal/barrier protections with a status enum alone.

## 5. Mnemonic replacement transaction — convert, M

**Files:** `A/shared/lib/profile/profileSessionOrchestrator.ts:438-582`; `A/shared/lib/profile/keyRecovery.ts:1-104`; `A/shared/blocks/KeyRecoveryScreen.tsx:1-168`; `A/features/onboarding/components/OnboardingScreen.tsx:35-107` (entry).

**Encoding:** locked/onboarding mode, held, phraseStored, saved snapshots and lock ownership. States: validating existing identities → closing wallet → prepared durable restore obligation → phrase committed → restart/held; preparation failure → rollback → refused. The phrase write is the point of no return.

**Illegal:** rollback failed but returned ordinary false, wallet already closed but UI described as retryable; saved new root with runnable old keys. **Traced:** failed phrase storage executes putBack; rollback errors are logged and swallowed at 555-556 before false is returned. This can leave the prepared records on disk. The post-commit path correctly holds on restart failure; no traced new-root/old-live-wallet escape. Whether failed rollback needs a held UI rather than retry is a separate policy question, so defer that defect claim.

**Persistence:** SecureStore `user_mnemonic`; global `wallet-lifecycle` fields; `profile-store.activeAccountIndex/profiles`; `settings-store.hasSeenOnboarding`. Preserve disk shape and direct-writer versions. An explicit runtime prepared/committed/rollback-failed union requires no migration.

**Consumers:** orchestrator plus two recovery entry surfaces (key recovery and onboarding via keyRecovery); boolean result loses rollback detail.

**Pins:** `appGateRecoverySession.test.ts`, `accountIntegrityBoundaries.test.ts`, `profileStoreSideWriters.test.ts`, `keyRecoveryScreen.test.tsx`. Pin refusal after cleanup, each preparation write failing, rollback itself failing, process interruption at phrase write, and restart unavailable.

**Delete:** held/phraseStored flags and broad catch-derived boolean outcomes; transaction reducer or typed sequential transaction with explicit ownership transfer. No new durable transaction format in this pass.

## 6. Coco open / background / close ownership — convert incrementally, M

**Files:** `A/shared/providers/CocoProvider.tsx:57-215,225-401`; `A/shared/lib/cashu/manager.ts:372-447,708-755,960-1040,1324-1480`; `A/shared/providers/awaitRestoreReady.ts:1-43`.

**Encoding:** provider manager/isReady/failed/attempt/hasStarted/bgStarted; singleton instance/db/pendingInit/pendingCleanup/cleanupFailed/pendingBackground; captured identity and reset generation. States: waiting credentials, opening, usable, background-waiting-restore, background-running/degraded, closing, closed, open-failed. Background readiness is a parallel region, not a single replacement boolean.

**Illegal:** manager present treated as fully initialized while plugin initialization is unresolved; old background work reporting into a new stage generation; closed provider retaining restore waiter. **Traced:** manager assigns instance before awaited initPlugins, and initialize checks instance before pendingInit, so a second direct initialize can return during plugin initialization. The provider has a once-start guard; no new user-triggered caller trace established here. F123 already covers never-settling open/close; F77 covers retained restore waiter. Phase 2 catches early setup failure and marks its stage complete: this is degraded completion today, not proof all recoveries ran. Recovery failures are now isolated individually, fixing pass 0's broad recovery-aborts-chain concern.

**Persistence:** phase flags transient; manager owns existing account SQLite and credentials. Conversion must not change DB names/schemas or credential derivation. Runtime ownership can wrap the current interfaces.

**Consumers:** provider's phase-1 and phase-2 effects and rendering (3 places), singleton initialize/cleanup/readiness (3 places), orchestrator switch admission; keep the many manager API callers on the stable facade.

**Pins:** `cocoProviderRetry.test.tsx`, `cocoProviderPhase2.test.tsx`, `cocoCleanupDuringInit.test.ts`, `cocoBackupLifecycle.test.ts`. Need plugin-init rejection plus concurrent second open, restore-wait cancellation, generation-safe late failure and cleanup failure followed by retry.

**Delete:** ready/manager duplication and startup refs; centralize abortable phase-2 sequencing and generation ownership. Keep captured-identity checks. Do not undertake a whole manager rewrite just to make the provider state explicit.

## 7. NDK delayed initialization and failed-start latch — convert, S

**Files:** `A/shared/providers/NostrNDKProvider.tsx:41-239`.

**Encoding:** hasInitialized ref, isInitialized state, optional adapter/index, deferred timer, stage status and external ndk. States: waiting, scheduled, initializing, ready, failed, disposed. Events: keys/dependencies ready, timer, init return/throw, cleanup.

**Illegal:** hasInitialized=true, isInitialized=false and stage error with no next event that retries. **Traced:** timer sets the latch at 196, initializer throws, catch reports stage error at 215-219 and leaves the latch true. Every subsequent effect returns at 146. See D2. Cleanup before the timer fires is safe: it cancels without claiming the latch. Cache closure is already F77.

**Persistence:** phase transient; cache DB `nostr` / `nostr-<accountIndex>` remains unchanged.

**Consumers:** two local effect regions plus readiness context used by NostrSignerProvider and own-relay-list sync. Do not confuse context ready with relay connectivity.

**Pins:** `nostrNdkInitialization.test.tsx` covers gating, deferred replay, account change and keys disappearing, not initializer throw. Pin failure/retry and no duplicate SQLite open first.

**Delete:** latch plus ready boolean in favor of a small reducer with attempt ownership; reuse adapter safely and explicitly expose failed/retry behavior.

## 8. AccountSwitchBoundary acknowledgement handshake — convert, S

**Files:** `A/shared/providers/AccountProviders.tsx:87-161`; `A/shared/lib/profile/suspendHelpers.ts`; callers `A/shared/lib/profile/inProcessProfileSwitch.ts:36-88`.

**Encoding:** suspended state and ref mirror, suspending promise, one untyped acknowledgement slot. States: mounted, dismissing, suspending, suspended, resuming. Events: suspend/join, sheets dismissed, React commit, resume, navigation-reset failure.

**Illegal:** mounted with pending resume that can never receive a state-change acknowledgement; one request replacing another's acknowledgement. **Traced:** resume while already mounted sets false again and leaves its promise unresolved. Existing test pins this. Normal switch calls suspend and awaits it before resume, so that caller prevents the path. Concurrent suspend joins are explicitly protected; concurrent resume is not. Do not elevate misuse-only state to a production defect.

**Persistence:** none. **Consumers:** one boundary owner, two callers (normal switch and fallback hold) in inProcessProfileSwitch.

**Pins:** `accountSwitchBoundary.test.tsx`, including redundant resume and navigation failure. Need duplicate resume and unmount while acknowledgement is pending. **Delete:** mirrored bool and shared acknowledgement slot; reducer commands return idempotent phase-specific promises. Cost is small, but rank below actual user-reachable failures.

## 9. Delete-all progress and profile removal — defer durable redesign; leave explicit removal result, M

**Files:** `A/shared/lib/profile/profileSessionOrchestrator.ts:585-683`; `A/shared/lib/profile/removeProfile.ts:3-75`; `A/features/settings/screens/DeleteScreen.tsx:18-30`; `A/shared/blocks/KeyRecoveryScreen.tsx:1-168` (delete result consumer); `A/shared/lib/profile/profileRemovalStorage.ts:1-373` (deletion ports).

**Encoding:** delete-all erasing flag plus lock/splash, profile snapshots and procedural step; remove-one already returns removed/refused/failed with completed/remaining steps. States: admitted, prepared, erasing, partial-erasure-held, erased/restarting, refused.

**Illegal:** user-visible success after refused deletion; erased databases with old keys still present; no durable progress after a crash. **Traced:** first is F177, partial deletion/journal gap F92, unbounded awaits F83. Post-erasure exceptions deliberately keep the lock and hold instead of resuming; partial erasure is a necessary failure state, not something a union makes disappear. Remove-one revalidates identity before each step and has an explicit result already.

**Persistence:** deletes SecureStore, account SQLite, caches and AsyncStorage; `profile-store.profiles[].walletDatabaseCreated` is forgotten before wipe. A runtime result union can preserve shapes. Durable resumability needs a new journal and recovery policy: defer, not a pass-2 format change.

**Consumers:** delete-all has two UI result consumers, DeleteScreen and KeyRecoveryScreen, with different handling; removeProfileData is the one removal executor under its caller's lock.

**Pins:** `deleteScreen.test.tsx`, `removeProfile.test.ts`, `profileRemovalCaches.test.ts`, `profileSwitchOrdering.test.ts`. Pin crash boundaries and retry after partial wipe before journal design. **Delete:** erasing/bool return ambiguity for delete-all; leave remove-one's useful discriminated result and step list.

## 10. Nostr key startup versus on-demand derivation errors — convert, M

**Files:** `A/shared/providers/NostrKeysProvider.tsx:86-128,130-244,246-432`; `A/shared/blocks/AppGate.tsx:128-142,205-207`; `A/shared/providers/CocoProvider.tsx:243-274`.

**Encoding:** keys, cashuMnemonic, isLoading/isReady/error, hasStarted, mounted, mnemonic loading/locked, integrity failure and four per-account cache/in-flight maps. States: awaiting storage, locked, loading identity, integrity-stopped, ready, failed; on-demand derivation has an independent per-account pending/result/error region.

**Illegal:** ready current account plus error from a different account derivation appears like startup failure; ready without matching keys/phrase; cache key shared across root generations. **Traced:** getKeysForAccount or getCashuMnemonicForAccount sets provider error on failure and never clears it on later on-demand success. AppGate deliberately ignores error when ready (pinned by appGateOrder), so no current lockout claimed. Account-keyed remount and restart for phrase replacement prevent ordinary cross-root cache reuse; mounted checks prevent late startup commits.

**Persistence:** flags/maps transient; keys/phrase and profile row persistence are delegated. Keep key names and profile format unchanged; use a runtime loaded-identity object. **Consumers:** readiness/error branch in AppGate, keys/phrase in Coco, keys in NDK; many other consumers take keys only (47 hook occurrences in non-test app search, including definition/bridge). Avoid changing them all.

**Pins:** `accountIntegrityStartup.test.tsx`, `nostrKeysImportedFallback.test.tsx`, `loadAccountKeys.test.ts`, `appGateOrder.test.tsx`. Need failed on-demand derivation then success while current wallet stays ready. **Delete:** startup boolean tuple and shared on-demand error sink; keep single-flight maps, which represent different derivation products, not inherently invalid parallel collections.

## 11. Backup challenge, accepted-answer delay and certification — leave for now, M if converted

**Files:** `A/features/backup/BackupFlowProvider.tsx:12-92`; `A/features/backup/screens/BackupVerifyScreen.tsx:51-101`; `BackupDoneScreen.tsx:13-25`; `BackupWordsScreen.tsx:15-73`; `BackupIntroScreen.tsx:14-51` in the same directory; `A/features/backup/lib/verifyPlan.ts:1-83`.

**Encoding:** wordsWanted/loading/words/plan, progress position/misses, active/focused, completed/opened refs, accepted/locked/timer. States: prompt, loading phrase, displaying, answering, answer accepted awaiting advance, all verified, background-hidden, demo. Events: reveal, answer, delay expiry, focus/background loss, mode switch, Done mount.

**Illegal:** completed with fewer than twelve answers; accepted but unlocked; certification in demo. **Traced prevention:** Done checks position===12; verify handler locks synchronously against double taps; blur cancels the timer and resets accepted/lock; mock-mode change keys the session anew; demo never writes verification. No reachable false-certification path established. Empty/invalid mnemonic yields no question rather than verification.

**Persistence:** only certification fields `wallet-lifecycle.recoveryPhraseVerifiedAt/Revision` and CTA timing via startBackup; words and challenge progress are transient. Preserve saved markers and never persist the phrase in a new state object.

**Consumers:** four screens read one context; Verify and Done own the two transition points. **Pins:** `backupFlow.test.tsx`, `backupVerifyPlan.test.ts`, covering double taps, blur, missing phrase, direct Done and demo reset. Before conversion add background during final accepted-answer delay and repeated Done mount. **Delete if later converted:** accepted/locked duplication and timer handling with a small answer-state reducer. Existing tests and guards make this lower return than recovery/startup.

## 12. App gate selection, terms and onboarding — convert selector only; leave local steps, M

**Files:** `A/app/_layout.tsx:294-348`; `A/shared/providers/AccountProviders.tsx:57-84`; `A/shared/blocks/AppGate.tsx:39-104,128-215`; `A/features/onboarding/screens/TermsAndConditionsScreen.tsx:25-168`; `A/features/onboarding/components/OnboardingScreen.tsx:35-125`; `A/shared/blocks/InitializationGate.tsx:63-148`; `GlobalMigrationGate.tsx:33-45` in the same directory.

**Encoding:** locked, key tuple, settings hydration, revision acceptance, onboarding seen, reinstall state; terms step/checks/recovery view; carousel index/direction; migration gate status/attempt/startedAttempt. Named gate states: storage failure/loading, keys locked/failed, terms, reinstall check, onboarding, keys loading, restore, app. Events: hydrate/retry, accept revisions, probe seed, finish carousel, keys ready. These are priority decisions over independent facts, not all mutually exclusive lifecycle flags.

**Illegal:** marking onboarding complete during an abandoned render; terms accepted with missing current revisions; migration success assumed after failure. **Traced:** reinstall branch calls completeOnboarding during render at AppGate:186. Current ordering is deterministic and pinned, but render replay/abandonment is not; do not call a saved false acceptance proven. GlobalMigrationGate signals storage readiness only after successful migrateThenLoad. Onboarding bounds its index; terms has explicit terms/privacy steps. The provider composition puts Coco and Colada above AppGate: moving gates would change which work occurs before acceptance, not merely refactor.

**Persistence:** `settings-store.legalAcceptance`, legacy `termsAccepted`, `hasSeenOnboarding`; reinstall uses SecureStore `user_mnemonic` and lifecycle seed stamp. Keep shapes and legacy notification-history meaning. **Consumers:** one AppGate selector, two local onboarding screens, root composition and migration gate. **Pins:** `appGateOrder.test.tsx`, `appGateReinstallDetection.test.tsx`, `legalAgreementScreen.test.tsx`, `onboardingTermsSelectors.test.ts`, `accountSwitchBoundary.test.tsx`, `initializationGateRetry.test.tsx`. Pin replay-safe reinstall completion and provider-before-gate behavior. **Delete:** interleaved selection and render-time write via pure gate selector plus explicit completion effect. Do not combine carousel/terms into the wallet lifecycle machine.

## Additional explicit/deferred shapes

- Native splash (`NativeSplashLayoutGate.tsx:100-165`) already names await_init/await_anchor/morphing/fading/unmounted. Leave its phase model; this survey did not audit the remaining animation/deadline effects.
- Claim username (`ClaimUsernameScreen.tsx:331-371,382-391,445-542`) carries username, domain, per-domain loading/availability and checking/claiming flags. Traced stale availability remains for the previous name during the 400 ms debounce, but the actual claim submits the current name and server claim is authoritative. Defer conversion until tests pin edit-while-claiming, debounce and errors; a request-keyed result union would remove stale-result ambiguity. No payment-format change proposed.
- InitializationGate already has pending/complete/failed; its attempt sentinel is a small replay guard. Leave it outside the broader reset repair, with `initializationGateRetry` preserving failure-before-storage-unlock semantics.

## Defects

**D1 — Pending mint operations deleted without successful restore coverage (traced, new).** `A/features/settings/screens/SettingsRecoveryScreen.tsx:507-529`, failure/cancellation decisions only at `557-580`. Start recovery for known mint A; A's addMint or every keyset restore fails (or cancel before remaining keysets); finalization still lists and deletes every pending mint operation. The stated justification that proofs were recovered is false on this path. This is deletion of retry/recovery records, not proof that funds are permanently lost. Failing test: reject A's restore with a pending A operation and assert deleteMintOperation is never called for it; repeat after cancellation. Repair changes which existing Coco rows are deleted, **touches stored data behavior**, but requires no stored schema or wire-format change. Also pin that unrelated/new pending operations are not deleted merely because they appeared during the run.

**D2 — NDK start failure permanently consumes its start latch (traced, new).** `A/shared/providers/NostrNDKProvider.tsx:146,196-219`. initializeNDK throws after hasInitialized=true; stage errors, readiness stays false, later effects exit immediately and no retry action exists. Nostr-dependent services remain uninitialized until provider remount/restart. Failing test: make first initializeNDK throw, trigger the supported recovery event after repair, assert a second initialization and readiness with a single owned adapter. Repair is transient state/UI behavior, **no stored shape or wire-format change**; cache lifetime remains F77.

**Existing defects, cited rather than duplicated:** F175 (give-up blank app, reproduced by the sole test run here); F178 (recovery timeout/dead-end paths, traced and existing tests inspected); F177 (ignored delete result); F77 (restore waiter/cache lifecycle); F123 (unbounded open/close); F83/F92 (deletion waits and absent durable progress). Existing follow-ups were searched before classifying D1/D2.

## Not read

Not a full audit of all providers: WalletContextProvider, NostrSignerProvider, PricelistProvider, BitchatBLEProvider, OfflineProvider, ThemeProvider, BackgroundProvider, hero-transition and Whitenoise internals were not read end to end. Coco manager was read at lifecycle seams listed above, not the complete database/plugin setup or upstream library implementation. No external wallet implementations or NUT documents: no protocol design or behavioral conversion was performed, and the brief prohibits network. Profile removal storage ports, keyRecovery UI plumbing, secureStorage failure implementation, payment consumers of restoreStatus, CTA internals, recovery discovery/probe internals, full recovery rendering, splash animation tail and username UI tail were not exhaustively read. No proof of native keychain/SQLite error behavior, real restoration coverage, restart success, or iOS/Android presentation. These limits are why rejection-path and concurrency hypotheses above are not promoted to confirmed defects.
