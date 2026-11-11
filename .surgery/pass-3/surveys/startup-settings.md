# Startup, accounts, providers and settings — pass 3

Surveyed HEAD: `999c5583ffc6b9baa2db3dadaa17dc31de9cebac`. Paths below are relative to this checkout. `A/` means `app/`; test basenames mean `app/__tests__/`. Counts are production caller files unless explicitly described as call sites. Estimates are **net product lines removed**, excluding tests; they are estimates, not measured patches, and overlapping cuts must not be added together.

Read the pass-3 brief, codebase-design skill and DEEPENING vocabulary, AGENTS, prior settings/onboarding/routes and startup/accounts surveys, relevant shared-settings survey sections, pass-2 ledger, and account-lifecycle documentation. Source and caller searches are current; previous survey findings are leads, not fresh execution evidence. TypeScript guidance was also consulted. Only this survey was written. No network, jg, agents, tests, builds, knip or saved checks were run. Test files below were located and selectively inspected; no passing-test claim is made. Dead members are source-search findings, not a knip-certified export inventory.

The ledger matters: wallet-manager ownership, restore predicates and recovery-run machinery were just rewritten. They are not proposed for another redesign. Theme commit revision ownership also stays. All proposed cuts preserve stored keys, fields, versions, bytes and wire formats, and preserve when writes happen. Any repair that changes persisted outcomes is separately identified and excluded. Dependency seams with real test adapters are retained internally rather than removed just because production has one adapter. Imports remain app → wallet → nostr.

## Ranked candidates

### 1. Fold the one-client initialization gate into GlobalMigrationGate

**Module and all callers:** `A/shared/blocks/InitializationGate.tsx:7-148` (148 lines), `GlobalMigrationGate.tsx:33-46`. One production caller of InitializationGate: GlobalMigrationGate. The latter is mounted by `A/app/_layout.tsx:333`. Test-only generic gate clients are in `initializationGateRetry.test.tsx`.

**Caller obligation:** GlobalMigrationGate supplies ten props, including identities and ordering policy that never vary: `tag="GlobalMigrationGate"`, `stageId="global-migrations"`, `outlivesAccount`, and `run={migrateThenLoad}` at lines 36-41; it must also remember `onSuccess={signalMigrationsComplete}` at 42 and the storage failure renderer at 43. There are no second or third production callers to quote. The generic module mirrors run and success callbacks into refs (InitializationGate:119-120), maintains an optional failure-with-no-UI branch (139-141), and passes the metadata through another argument bag (46-71).

**Shape/owner:** GlobalMigrationGate becomes the one deep module, with only children as its public interface. Move its existing attempt/retry, failure and stage implementation there; bind migrateThenLoad, success signal and storage failure UI privately. Retain module-scope async work for the React Compiler. Delete InitializationGate, its generic prop/run bags and callback freshness plumbing that serves constant functions.

**Deletion test:** Deleting only the generic wrapper without moving its implementation would lose retry and fail-closed mounting. Folding it loses only hypothetical customization; those safety behaviors remain in the existing migration owner.

**Deletion/size:** roughly 45–70 net lines; S for the two implementation files, M including tests/inventory references. Mechanical after tests are moved; no new layer. Separate from candidate 3's stage metadata saving.

**Risk and pins:** High consequence, modest implementation risk: signaling storage too early can lose saved state. Keep migration → load → success signal → children order exactly; no migration changes. `initializationGateRetry.test.tsx`, `globalMigrationsRunner.test.ts`, `initializationStagesAcrossSwitch.test.tsx`, `releaseFixtures.test.ts`. Move retry/error/success assertions to rendered GlobalMigrationGate; delete the generic-only no-failure-renderer test because that configuration never ships. Pin failed run never signals, retry signals once, and children stay absent before success.

### 2. Let the keyring screen's existing controller own refresh and setters

**Module/callers:** `A/features/settings/screens/SettingsKeyringScreen.tsx:248-400,412-506`. One file, four handler call sites: load (432), generate (446), submit import (485), import current identity (502). These module-private functions have no external production callers.

**Obligation:** `loadKeypairsImpl(manager, {setIsLoading, setKeypairs, setLoadSucceeded})` at 432; `generateKeyImpl(manager, loadKeypairs, setIsGenerating)` at 446; `importCurrentNsecImpl(manager, nostrKeys, loadKeypairs, {setIsImportingCurrentNsec, setKeypairs})` at 502-505. The screen must construct the same setters and thread its own reload operation through three mutations. This is a wide interface to implementation details, not a useful domain seam.

**Shape/owner:** Keep ownership in the keyring feature: a private hook/controller in this same file returns the displayed key list/load state and generate/import actions. It captures manager and current identity once and owns refresh-after-success. Keep prompt helpers (setError/close/finalize) at the prompt seam; do not move secret handling to a global store. Module-scope async bodies may remain, with one private controller dependency object rather than repeated setter bags. Delete component-side state plumbing, callback forwarding and repeated refresh parameter declarations. Do not add a generic CRUD controller.

**Deletion test:** Removing *all* handlers loses parsing, duplicate-key detection, feedback and single-flight protection. Those earn their keep. Removing their setter/refresh-facing seam loses only caller assembly; the same behavior belongs inside the existing feature module.

**Deletion/size:** 25–45 net lines if the controller replaces the old plumbing rather than coexists with it; S (same source file plus screen test). Not a blind mechanical extraction: preserve compiler eligibility and async lifetimes.

**Risk/pins:** Keys and wallet mutations; exact addKeyPair arguments, write count, refresh ordering and no new storage must stay. `keyringImport.test.tsx` pins valid nsec/hex, invalid input, double taps, current-key deduplication. Add generate success/failure and reload failure assertions before cutting. Keep screen tests; no standalone Impl tests were found to delete. F176 is a separate existing defect, not permission to change import outcomes during this cut.

### 3. InitializationProvider should own its fixed five-stage graph

**Module/callers:** `A/shared/providers/InitializationProvider.tsx:45-73,325-349`. Four production caller files, five hook invocations: `NostrKeysProvider.tsx:89`, `CocoProvider.tsx:233,238`, `NostrNDKProvider.tsx:131`, `A/shared/blocks/InitializationGate.tsx:107` (GlobalMigrationGate after candidate 1).

**Obligation:** NostrNDK declares `dependsOn: ['coco'], blocking: false` (131-135); Coco declares its own stage and background stage separately (233-242); migration supplies its outlives-account flag through GlobalMigrationGate:38. Every caller must know the startup graph, uniqueness of string stage IDs and which stages survive account switches. The hook then joins/splits dependencies solely to stabilize config literals (InitializationProvider:329-349).

**Shape/owner:** Existing InitializationProvider owns a closed stage-ID metadata table; `useInitializationStage(id)` returns the same log/complete/error/canStart operations. Move static message, dependencies, blocking and outlives-account facts into that table. Keep registration timing and reset behavior unchanged. Tests can drive named stages, with private test setup only if genuinely needed.

**Deletion test:** Removing the provider loses coordinated readiness and splash behavior; it is deep. Removing caller configuration loses no shipped variability. Delete the public StageConfig argument and join/split stabilization, not dependency gating itself.

**Deletion/size:** about 20–35 net lines after adding the table; M (five or six implementation files plus focused tests, under ten with a selected test migration). Mechanical metadata movement, with ordering checks. If the total affected files exceeds nine, split metadata and test migration or classify L.

**Risk/pins:** Startup/navigation; indirectly protects storage. `initializationStagesAcrossSwitch.test.tsx`, `initializationGiveUp.test.tsx`, `cocoProviderRetry.test.tsx`, `cocoProviderPhase2.test.tsx`, `nostrNdkInitialization.test.tsx`, `initializationGateRetry.test.tsx`. Pin the exact current graph and account-surviving migration stage. Delete tests of hypothetical arbitrary graph configuration only after retaining real graph cases. F175 is not solved by this cut.

### 4. Reuse settleWithin for the two other account timeout implementations

**Module/callers:** `A/shared/lib/profile/settleWithin.ts:1-25`, `profileTransition.ts:183-201` (cleanupCocoWithTimeout), `inProcessProfileSwitch.ts:19-34` (switchStep). cleanupCocoWithTimeout has one caller file, profileSessionOrchestrator:216,244. switchStep has two caller files: inProcessProfileSwitch:41,42,57,59,61,62,64,66,72,77,87 and profileSessionOrchestrator:208. Existing settleWithin consumers are profileTransition, profileSessionOrchestrator and profileRemovalStorage:274.

**Obligation:** Three owners maintain the same timer/race/finally cleanup algorithm. Callers intentionally need different timeout outcomes: switchStep throws, cleanup logs and continues, guard reads return a sentinel. Examples: `switchStep(boundary.suspend)` at inProcessProfileSwitch:61; `cleanupCocoWithTimeout()` at orchestrator:244; `settleWithin(getKeysForAccount(nextIndex), KEY_DERIVATION_TIMEOUT_MS)` at 309.

**Shape/owner:** settleWithin owns timer mechanics. Keep named switchStep and cleanupCocoWithTimeout policy operations, implemented by calling it and mapping TIMED_OUT to the same error/log. Retain `Promise.resolve().then(operation)` in switchStep: it also normalizes synchronous throws. Do not unify timeout durations or turn a timeout into cancellation.

**Deletion test:** Deleting policy wrappers loses important semantics, so retain them. Deleting their private timer implementations loses nothing once delegated to the existing timer owner.

**Deletion/size:** 18–28 net lines; M (three source files plus tests). Mechanical if rejection, timing and continuation semantics are pinned.

**Risk/pins:** Late native work can still run after timeout; a cleanup timeout must never authorize resume. Preserve the existing held/restart behavior. `profileSwitchOrdering.test.ts`, `inProcessProfileSwitch.test.ts`, `profileRemovalCaches.test.ts` cover surrounding sequences. Pin reject, settle-before-deadline, timeout, and late settlement with fake timers, including the exact cleanup warning. Keep policy tests; no new timeout framework or standalone wrapper test layer needed.

### 5. Remove dead theme draft surface, including its ignored units parameter

**Module/callers:** `A/features/theme/lib/themeDraft.ts:33-60,133-147,175-182`. beginDraft has one production caller, `ThemePreviewScreen.tsx:116`, plus two test files (`themeDraftCommit.test.ts`, `themeDraftAlbumDistribute.test.ts`). resetDraft has zero production callers; its only located invocation is themeDraftCommit.test.ts:241.

**Obligation:** Preview computes `UNIT_IDS = PREVIEW_UNITS.map(...)` at 51 only to call `beginDraft(UNIT_IDS)` at 116. Implementation explicitly accepts `_unitIds` at themeDraft:133 and never reads it. Tests pass different arrays at themeDraftCommit:84,129 with no corresponding behavior. resetDraft duplicates snapshot copying but no screen offers the action.

**Shape/owner:** Existing theme draft remains owner. Change beginDraft to zero arguments, delete the preview-only UNIT_IDS derivation and resetDraft type/implementation. Leave setAlbum's units parameter: its one production caller actually uses it to determine assignments. Leave the new commit revision counter and cancellation logic entirely alone.

**Deletion test:** No user-visible capability disappears: Begin snapshots the saved store irrespective of its argument, and Reset has no production entry. Discard and reopening still exist.

**Deletion/size:** roughly 13–18 net lines, S for product files; M with the two test files. Mechanical. This small cut qualifies on a recently edited module specifically because the unused interface is directly proven.

**Risk/pins:** Theme draft is transient; unchanged commit writes still target the same saved theme. `themeDraftCommit.test.ts` and `themeDraftAlbumDistribute.test.ts`; keep snapshot/dirty/commit/cancel tests, delete only the reset-only portion of the combined test and update argument-free calls. No schema or timing change.

### 6. Remove splash override knobs from public account operations

**Module/callers:** `A/shared/lib/profile/profileSessionOrchestrator.ts:105-114,281-286,590-593`; `profileTransition.ts:256-261`. Five production consumer files across these three operations: `A/shared/blocks/DrawerProfileChrome.tsx:81,89`, `AccountMismatchScreen.tsx:60`, `A/features/nostrSigner/lib/switchProfileAndPair.ts:81`, `A/features/settings/screens/DeleteScreen.tsx:24`, `A/shared/blocks/KeyRecoveryScreen.tsx:91`. None supplies resetStages or cancelResetStages. splashControls itself has one production caller file, orchestrator:148,302,398,603.

**Obligation:** The public operation bags advertise caller-selectable reset/cancel hooks, while actual callers always rely on `TransitionControlRegistrar` (AccountProviders:164-170). The orchestrator repeatedly resolves `splashControls(opts)` and passes the result to lock.holdSplash. Drawer passes only accountIndex; delete passes nothing; stopped-account switch adds only fromStoppedAccount. The latter is real behavior and must stay.

**Shape/owner:** profileTransition owns the registered splash controls. Remove reset/cancel options from the public operation types and make holdSplash obtain registered controls itself. Keep an internal test seam for controls/lock tests, using the existing registerTransitionControls entry rather than operation options. Keep create's getKeysForAccount test seam: profileSwitchOrdering and accountIntegrityBoundaries really inject different derivation outcomes.

**Deletion test:** Removing registered controls loses splash safety. Removing per-operation overrides loses no production choice; tests must still be able to install controls. No claim that every injected dependency is unnecessary.

**Deletion/size:** 12–22 net lines; M (three production files at most plus tests). Mechanical interface narrowing; not the F175 reset repair.

**Risk/pins:** Account startup ordering; no changed storage writes. `profileTransitionLock.test.ts` explicitly tests hold/release callbacks, `profileSwitchOrdering.test.ts`, `initializationStagesAcrossSwitch.test.tsx`, `initializationGiveUp.test.tsx`. Preserve absent-registration behavior rather than silently making it throw. Delete override-only assertions only after moving them to registration-based tests.

### 7. One owner for newest-first album wallpaper membership

**Module/callers:** `A/features/theme/lib/useAlbumList.ts:60-75,147-150`; existing owner candidate `A/shared/lib/theme/resolveUnitWallpaper.ts:32-44`. useAlbumList has three caller files: ThemePreviewScreen:112 (getAlbum), GalleryScreen:59 (byTopic), BackgroundScreen:53,132 (albums/getAlbumWallpaperNames). getCatalogThemesForAlbum currently has two production function callers in two files: themeDraft:92 and resolveUnitWallpaper:59.

**Obligation:** Background renders `getAlbumWallpaperNames(album.slug)` (132), while applying an album uses another membership/order implementation through `getCatalogThemesForAlbum(catalog, albumSlug)` (themeDraft:92). useAlbumList sorts each grouped list by createdAt (72), and the resolver separately filters/sorts/maps (40-44); both special-case the synthetic Colors album. Maintainers must preserve identical ordering in chooser, default resolution and distribution.

**Shape/owner:** Keep membership/order rules in the existing pure wallpaper resolver module. Have useAlbumList consume that rule; retain its publisher/topic grouping and cover/newest metadata ownership. Prefer a small shared grouping computation in that existing module if needed to avoid repeated full-catalog scans. Do not add a catalog repository or cache.

**Deletion test:** Deleting useAlbumList would scatter useful grouping policy across three screens, so do not delete it. Delete only duplicated theme-name ordering/synthetic handling once it delegates to the existing pure owner.

**Deletion/size:** 8–18 net lines; M, around three implementation files plus tests. Conditional candidate: if preserving current grouped traversal requires more new code than is removed, leave it. No performance claims without measurement.

**Risk/pins:** Presentation plus deterministic wallpaper assignment. Preserve stable equal-timestamp ordering, Colors order, absent album behavior and author sections; no persisted assignments change. `resolveUnitWallpaper.test.ts`, `themeDraftAlbumDistribute.test.ts`, `themeDraftCommit.test.ts`. Add rendered picker/order agreement for an unsorted catalog and tied timestamps. No shallow tests to delete were established.

### 8. Backup session should accept an answer, not its own reconstructed state

**Module/callers:** `A/features/backup/BackupFlowProvider.tsx:12-24,35-36,59-72`; `A/features/backup/lib/verifyPlan.ts` (advanceVerify). All four context consumers are BackupIntroScreen, BackupWordsScreen, BackupVerifyScreen, BackupDoneScreen; only Verify writes progress. Verify:52 reads plan/progress/setProgress; 75-78 reconstructs `{...progress, answerIndices: plan.map(...)}` to call advanceVerify; 81 and 97 hand its result back through setProgress. Done:14-25 separately checks position 12 and certifies.

**Obligation:** Verify must reconstruct information the session already owns and can arbitrarily replace progress. The context setter promises VerifyState but discards answerIndices (provider:63-64). This leaks the pure reducer's internal representation into a UI consumer.

**Shape/owner:** BackupSessionProvider owns answer evaluation and advancement, exposing current question/progress and an answer operation instead of plan + generic setProgress. Keep pure advanceVerify as an internal tested seam. Preserve the 250 ms accepted-answer display and the existing blur cancellation: an answer may be evaluated now but committed only by its still-valid delayed completion. Keep certification at the same Done-mount point in this cut; moving it earlier changes saved outcomes and is out of scope.

**Deletion test:** The provider earns its keep by owning phrase/demo lifetime. Removing the raw state round trip loses no UI capability. Do not merely rename setProgress to advance while still requiring caller-computed state.

**Deletion/size:** likely 5–15 net lines, M (provider, Verify and tests). Lower-ranked, not mechanical: do it only if the replacement deletes more plumbing than its delayed-answer ownership adds. A broad backup state machine is not justified here.

**Risk/pins:** Secret phrase and certification marker; never add phrase persistence, log choices, or certify demo mode. `backupFlow.test.tsx`, `backupVerifyPlan.test.ts` pin all twelve answers, wrong answer, double tap, focus loss, direct Done, missing phrase and mock-mode reset. Add final-answer blur before delay expires. Keep reducer tests and end-to-end context tests; remove only tests of the setter shape if any arise.

### 9. Delete the legacy isTermsAccepted action, retain its stored history

**Module/callers:** `A/shared/stores/global/settingsStore.ts:292,410`. Zero production callers of this member. Two test caller files: `settingsStorePersistResilience.test.ts` (85,110,165,186,203,247,329) and `settingsStoreSetters.test.ts` (188,193; 229 checks it is not saved). AppGate:134 uses a local variable with the same name, but computes current revision acceptance; it does not invoke the member.

**Obligation:** The surface offers two answers to acceptance: legacy historical boolean through the dead action and current legal revision acceptance used by AppGate. The pass-0 concern remains an interface concern, not a reason to merge persisted fields. Tests call `state.isTermsAccepted()` (resilience:247) and `store.getState().isTermsAccepted()` (setters:193), keeping the unused action alive.

**Shape/owner:** settingsStore retains legacy termsAccepted data unchanged; legalDocuments remains owner of current-revision acceptance. Delete only the action declaration and body. Assert the legacy field directly in persistence tests, while gate tests continue to assert revision acceptance.

**Deletion test:** No runtime behavior lost. Deleting termsAccepted itself WOULD lose historical notification cutoff information and old-install compatibility; explicitly excluded.

**Deletion/size:** 2 product lines plus some test surface; S for source, M with tests. Mechanical, lowest deletion return but prevents a misleading alternative interface in a legal gate.

**Risk/pins:** Stored data and legal navigation. Do not change partialize, schemas, migrations, acceptance dates or notification boundaries. `settingsStorePersistResilience.test.ts`, `settingsStoreSetters.test.ts`, `legalDocuments.test.ts`, `appGateOrder.test.tsx`. Keep all persistence cases; delete action-specific test assertions rather than migration coverage. Source grep only; no knip verdict claimed for this object member.

### 10. Hide disk-guard refusal cleanup inside the transition lock

**Module/callers:** `A/shared/lib/profile/profileTransition.ts:204-253`; one production consumer file, profileSessionOrchestrator. Four disk-guard callers: switch:129-132, create:297-300, import:392-395, delete:596-599. Five acquireTransition callers additionally include recoverMnemonicSession:444, which uses the memory guard without this disk step.

**Obligation:** Each of the four repeats `if (!(await lock.takeDiskGuard())) { await lock.release(); return ...; }`. Switch and delete return false; import has its own result. Create intentionally checks its derivation dependency after taking the memory lock and before disk admission. This is not a uniform five-flow transaction that can safely be wrapped in an unconditional finally.

**Shape/owner:** Existing transition lock owns refusal cleanup: replace takeDiskGuard with an admission operation that returns admitted/refused and releases only its own memory lock on refusal. Callers keep their different returned results and call timing. Recover remains memory-only. Do not automate post-admission release: restart and irreversible deletion deliberately retain the lock.

**Deletion test:** Removing locks loses isolation; removing four callers' refusal release instruction loses no capability if the lock performs that exact cleanup before returning. Do not infer a durable transaction journal from this small cut.

**Deletion/size:** roughly 5–10 net lines after implementing internal cleanup; S source, M with tests. Low-ranked because small savings touch consequential sequencing. Mechanical only after refusal ownership tests pass.

**Risk/pins:** Account concurrency and saved-state sequencing. Preserve other-runtime guard bytes, synchronous memory admission, timeout behavior and all held outcomes. `profileTransitionLock.test.ts` pins memory-only locks and foreign guard refusal; `profileSwitchOrdering.test.ts`, `accountIntegrityBoundaries.test.ts`, `profileStoreSideWriters.test.ts` pin flow refusals. Move the release-on-refusal assertion to the admission operation; retain all flow result tests. Adding disk admission to mnemonic recovery or releasing after an irreversible write is out of scope.

## Defects — existing IDs, not duplicate reports

These are current source traces, not new runtime reproductions. Follow-ups were searched before classification. Repairs are separate from the behavior-preserving cuts above.

- **F176 — invalid key closes before its error can be read.** SettingsKeyringScreen:327-341 sets an input error then always finalizes/closes in finally; caller is the Import action at 484-489. Existing keyringImport.test.tsx:187 explicitly pins closure. Failing-test idea: submit invalid input through the real host, assert the same sheet remains open with its error and no key is written. The host-level half is described in F176; not re-audited end to end here.
- **F177 — refused delete reported complete.** DeleteScreen:22-25 awaits a boolean then unconditionally logs complete; deleteAllProfiles:594-599 returns false for busy/refused admission. Failing-test idea: refuse admission, assert an error/retry state and no completion log. Existing deleteScreen.test.tsx pins the present behavior. No deletion was executed.
- **F218 — NDK failed start consumes the only start attempt.** NostrNDKProvider:146 returns on hasInitialized, 196 sets it before initializeNDK, 215-219 records error without resetting it. A throw during deferred initialization leaves readiness false until remount. Failing-test idea: throw once, trigger the agreed retry event, then require successful initialization with one adapter. The retry trigger still needs the decision recorded in F218.
- **F189 — failed primary wallpaper download still gets saved.** themeDraft commit awaits the store download but does not require its boolean success before committing; themeDraftCommit.test.ts:158-170 explicitly pins success despite false download. Failing-test idea: reject the download outcome and require unchanged saved theme plus a retryable draft. This changes what is saved, so **outside this pass's mechanical scope**. Preserve the already-fixed Apply→Cancel revision protection.

F175 remains an explicit constraint on initialization and transition proposals; this survey did not rerun its reproduction. No newly verified defect beyond the existing ledger IDs is claimed.

## Pieces that earn their keep

- Expo route re-export files are filesystem entrypoints, not redundant modules to delete: the path itself is an interface. Settings and prompt layouts also own navigation options and backup lifetime. Do not fold them into screens merely to shrink file counts.
- SettingsProfileScreen/ProfileDetailsScreen is not a one-client wrapper cluster: SettingsProfileRecoveryScreen is a second production caller with different, startup-safe data loading. Reading recovery data without the live key provider is a real seam.
- LayoutGuidesProvider and TouchIndicatorProvider keep store reads out of shared UI and supply context across overlays. NostrSignerProvider owns an account-scoped mount lifetime. Their small bodies alone do not justify deletion.
- WalletContextProvider aggregates real unit/mint/proof rules; it is not a pass-through. useWalletContextWithOverride has both an omitted argument (AmountFlowScreen:86) and an actual selectedMint override (CameraScreen:124); do not delete the option as constant.
- profileSwitchResource has real revocation/drain behavior. resetProfileNavigation has a readiness guard and a canonical reset target. keyRecovery has testable form seams, not just wrappers. They are not deletion candidates on this evidence.

## Not read

This was a focused interface survey, not a full account-safety audit. Provider inventory was read, with full or targeted reads of initialization, account composition, NDK, wallet-context and small overlay/signer providers. Coco/NostrKeys were read at stage and registration seams, not every key/cache/background branch. Offline, Background, Pricelist, Bitchat and hero-transition internals were only inventoried or sampled. No complete verdict on their interfaces.

Root layout and settings/prompt layouts were sampled; the whole app/app route tree, native-intent routing, drawer/tab mechanics and all navigation consumers were not re-audited. Onboarding source was covered principally through its prior survey and gate callers; claim-username network workflow and illustration internals were not deeply read. Settings design-system, moderation/media/network/storage/notification screens and edit-profile internals were not surveyed end to end. Backup UI rendering and theme gallery gestures/thumbnail rendering were not exhaustively read.

Account orchestration was traced at public operation, admission, timeout and hold/restart seams. SecureStorage native implementation, every removal port, persistence middleware, upstream Coco/plugins, full restore implementation and mint protocols were not read. No sibling wallets or NUT documents were consulted because no protocol change is proposed and the brief prohibits network. No native device, real wallet, migration, live mint, relay or timing experiment ran. Existing tests were selectively read, not all executed or audited. Estimates require a real diff before approval; this report makes no claim that a proposed cut has already passed checks.

Not read
