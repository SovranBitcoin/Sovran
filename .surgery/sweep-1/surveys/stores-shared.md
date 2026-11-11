# Sweep 1 survey: stores and shared code

Area: `app/shared/stores`, `app/shared/hooks`, `app/shared/ui`, `app/shared/blocks`, and `app/shared/lib` without
`cashu`, `nfc`, `persist`, `nostr`, `profile`, `routstr`. Branch `surgery/sweep-1` at `4c80d9f5c`.

Everything below was traced by reading unless it says "run". Nothing was run on a device. Paths are under `app/`
unless they start with `wallet/` or `docs/`.

Tools run: `bun run knip` (clean, so every removal below is something knip cannot see: a store member, a test-only
export, a field); ESLint on the 19 files of this area that have entries in `app/eslint-suppressions.json` (clean, so
no suppression in this area is stale); a script that resolves every `jest.mock('@/…')` path in the app tests (none
points at a deleted module); a reference count of every export and every store member of the area against all
product and test sources.

Verdict counts: 39 findings, 15 marked fix.

## 1. Broken

**B1. A cached read aborted on blur can show "fetching" for ever.** `shared/lib/read/useCachedRead.ts`. With
`abortOnBlur` (only `features/feed/hooks/useNotificationsPage.ts:218` sets it) the blur cleanup aborts the run
(lines 345-349); the run's `finally` then returns early because the signal is aborted (323-326), so `flight` is
never cleared. On refocus `start('revalidate','focus')` finds the entry still fresh and returns at "serve-fresh"
(247-250) without touching `flight`. `fetching` (360) stays true: `isFetching` true, `mode: 'refresh'`, status
`revalidating`, until the entry goes stale or the person pulls again. Path: Notifications, pull to refresh while the
page is fresh, switch tab before it answers, come back.
Test: fresh entry, `refresh()`, blur, focus, expect `isFetching === false`.
Saved or sent: nothing. **fix**: clear `flight` when the blur cleanup aborts (and in `finally` when the aborted
read is still the current flight). Not run.

**B2. One Sovran server decides whether the wallet is offline.** `shared/lib/offlineReachability.ts:44-52` has one
default probe, `GET <nagg>/livez` with a 1.5 s limit. `shared/providers/OfflineProvider.tsx:123` turns a failed
probe into "offline" (after its five second confirmation) and `features/send/providers/Colada.tsx:260` hands that to
`manager.setOffline`. So with working internet and nagg down or slow, every wallet sends offline, parks receives as
"when you're back online" and skips the version check. The module already supports several probes where any success
means online; only the list is short. Not in the follow-ups or ADR 0019.
Test: probes `[nagg fails, second succeeds]` gives `isOffline: false`; today's default list has no second.
Saved or sent: a second probe is a new network request to another host. **list**: the owner picks the second
witness (the selected mint, or a neutral endpoint) and accepts what it reveals.

**B3. A success that arrives for a toast already showing "failed" or "waiting" is dropped and logged as
confirmed.** `shared/stores/runtime/paymentStatusStore.ts:272-276`: when the result's owner is the toast on screen,
`delivery` is set to `'confirmed'` before `confirmActive` runs; `confirmActive` refuses `failed` and `waiting`, the
branch returns the unchanged state, and the result is neither held nor remembered as shown. The caller logs
`send_confirm_same_toast` / `melt_confirm_same_toast` (`shared/hooks/usePaymentStatusListener.ts:745`, `:906`).
The melt case is the toast half of F200 (a paid melt first reported failed): the later finalize changes nothing on
screen.
Test: active melt toast in `failed`, `deliverResult` for the same quote, expect either a confirmed toast or a held
result, not `'confirmed'` with state unchanged.
Saved or sent: nothing. **list**: the owner decides what a late success does to a failed or waiting toast (F200,
F234 are adjacent).

**B4. "Mint unreachable" on an offline-made token never re-checks.** `shared/stores/profile/sendReachabilityStore.ts`
saves the status for 30 days; `features/send/screens/SendTokenScreen.tsx` (about line 117) returns early when the
saved status is `mint-reachable` or `mint-unreachable`. One 1.5 s timeout therefore pins the warning on that token
until the phone goes offline and online again. `checking` is re-run on open; `mint-unreachable` is not.
Test: saved `mint-unreachable`, mount online with a mint that answers, expect `mint-reachable`.
Saved or sent: the repair re-reads a saved status and overwrites it with the same enum; no shape change. **list**:
the screen is in the payments area, and the owner should say how long an "unreachable" verdict may stand.

**B5. The backup prompt counts only sats as money.** `shared/blocks/CtaHost.tsx:27` reads
`useColadaBalance('sat')` and passes `balance.total` as `balanceTotalSat`; `shared/lib/cta/definitions.ts:43-44`
asks for the backup when that is above zero, else after seven days, and the body adds "You have money here now"
on the same test (`:49`). A wallet holding only USD ecash is not asked for a week and is told nothing about money.
Test: sat balance 0, usd balance 500, expect `backup-recovery-phrase` selected.
Saved or sent: nothing. **list**: needs a "holds anything in any unit" read (same family as F173, different
surface).

**B6. Amounts are converted with invented rates when the price list is missing or the unit is unknown.**
`shared/lib/currency.ts:39` holds fixed BTC prices (`usd: 63_900`, `eur`, `gbp`) that `getRate` uses whenever the
store has no price (63-71); nothing marks the result as an estimate. For a unit not in the table `getRate` returns
`1`, the BTC rate (75-78), so `formatAmount({amount, unit: <unknown>}, {displayAs: 'usd'})` multiplies the amount by
the BTC price (95-97). Units come from mints.
Test: empty price list, `formatAmount({amount: 1000, unit: 'sat'}, {displayAs: 'usd'})` returns a dollar figure
with no marker; unknown unit with `displayAs: 'usd'` returns amount times BTC price.
Saved or sent: nothing. **list**: the owner decides what a screen shows when there is no rate (nothing, a dash, or
a marked estimate).

**B7. Stopping the price feed mid-request leaves `isLoading` true.** `shared/lib/pricelistFeed.ts:64`: after the
await, `if (stopped || controller.signal.aborted) return;` skips the `onLoading(false)` at line 92.
`usePricelistStore.isLoading` (read by `shared/providers/PricelistProvider.tsx:26`) then stays true until the next
feed finishes a poll.
Test: `start()`, `stop()` before the fetch resolves, expect the last `onLoading` call to be `false`.
Saved or sent: nothing (`isLoading` is not saved). **fix**: `stop()` calls `onLoading(false)` when a request was
open.

**B8. The delete toast has the same latch as F187.** `shared/lib/popup/popups/deleteStatus.ts:18-35` is a second
copy of the swap toast's `mounted` flag (`popups/payment.ts:84-114`): set before `showCustomToast`, cleared only in
`onHide`. F187 names only the swap toast; with no toast host both latch. **list**: add to F187; one helper for both
when it is repaired.

## 2. Inconsistent

**I1. `settingsStore` comments describe behaviour it no longer has.**
`shared/stores/global/settingsStore.ts:116-132` says one bad field throws the whole settings blob away; the store
sets `independentFields: true` (462-464) and `createMergeWithSchema` keeps the fields that parse. Lines 465-470
describe "v1 -> v2" directly above `version: 4`. **fix**: rewrite both comments to what the code does.

**I2. Two identical routing defaults.** `settingsStore.ts:108-114` (`DEFAULT_MIDDLEMAN_ROUTING`) and `:153-159`
(`DEFAULT_MIDDLEMAN_ROUTING_PERSISTED`) hold the same five values. **fix**: one constant; saved shape unchanged.

**I3. `addProfile` has two doc comments, the first one stale.** `shared/stores/global/profileStore.ts:73` ("skips
if accountIndex already exists") sits above the current description (74-80), which says a different key at that
index returns false. **fix**: delete line 73.

**I4. `nostrMetadataCache` is described as the cache screens read; it is a write-behind mirror.**
`shared/stores/global/nostrMetadataCache.ts:1-12` says reads come from it and stale entries refresh through
`useNostrProfileMetadata`; its own field comment (line 55 on) says it is not read for rendering. The same old story
is in `shared/hooks/useNostrProfileMetadata.ts:258-265`, `useIdentityName.ts:7-10` and `useProfileDisplay.ts:13-14`.
The file is also the only store under `stores/global/` whose scope is `profile` (generated manifest). **fix**: the
four comments. Moving the file is **list** (it renames an e2e manifest key, nothing saved).

**I5. The 24 hour profile staleness limit is defined twice.** `nostrMetadataCache.ts:35`
(`NOSTR_METADATA_STALE_TTL_MS`, used by the single-profile read in `shared/lib/nostr/useEntityCache.ts:273`) and
`useNostrProfileMetadata.ts:77` (`STALE_TTL_MS`, used by the many-profile read at 314). Identical values.
**fix**: the hook imports the exported one.

**I6. `completeCounts` has two doc comments that contradict each other.** `shared/hooks/useNostrProfile.ts:89-95`
says "in order: Primal, then kind-3"; `:96-102` says concurrently, which is what the code does. **fix**: delete the
first.

**I7. The read-strategy table has ten call sites that do not use it, and two disagree.**
`shared/lib/read/readPolicy.ts` says `mintAudit: 'sequential'` and `noteStats: 'http'`;
`shared/lib/getDiscoveredMintMetadata.ts:38,55` logs `mintAudit` as `'http'` and
`shared/lib/nostr/fetchNoteStats.ts:77` logs `noteStats` as `'aggregate'`. Eight more sites hard-code a value that
matches (`useNostrProfile.ts:229`, `useNostrProfileMetadata.ts:41`, `getMintCatalog.ts:167`,
`features/mint/hooks/useMintDetailRead.ts:78`, `features/payments/hooks/useDmEnvelopePages.ts:184`,
`features/send/lib/createSovranScreenActionsBridge.ts:621`, `shared/lib/cashu/paymentRequestNostrTransport.ts:359`).
Log field only. **list**: someone who knows the two engines says which side is right; then every site calls
`readStrategyFor`.

**I8. Three legacy per-transaction stores are still written beside the annotation store that replaced them.**
Distribution: `features/send/lib/sovranPaymentConfig.ts:1723-1724`, `:1763-1764` and
`createSovranScreenActionsBridge.ts:413-414` write `transactionDistributionStore` and `setDistributionAnnotation`
on consecutive lines. Location: `shared/hooks/useTransactionLocation.ts:62-65` writes both. Scan link:
`sovranPaymentConfig.ts:748-750` writes both. Readers already prefer the annotation
(`createSovranScreenActionsBridge.ts:316-322`), and `shared/lib/migrations/dataMigrations.ts:84-135` imports the
old stores once. **list**: stopping the old writes changes what is saved; the owner decides when the three stores
freeze.

**I9. Comments naming things that are gone.** `shared/stores/profile/transactionAnnotationStore.ts:4,79` says
"MMKV/AsyncStorage" (no MMKV dependency exists); `transactionDistributionStore.ts:26-28,36` places `getSourceLabel`
and the `displayed` writer in `Colada.tsx` (they are in `createSovranScreenActionsBridge.ts`);
`shared/stores/runtime/nfcTapStore.ts:8-9` says `creating`/`writing` arrive "once executeNfcSend write-back is
wired" (`sovranPaymentConfig.ts:552-554` already forwards every phase); `shared/hooks/useHeaderSearch.ts:8` says
"contacts layout" (the caller is `shared/ui/composed/SearchLayout.tsx`). **fix**: four comment edits.

**I10. `useNostrTierHealth` builds a stable key for the host list and then depends on the list anyway.**
`shared/hooks/useNostrTierHealth.ts:67-68` makes `primalUrlKey` because "the list itself is rebuilt on every config
read", and the `runProbes` dependency array (132) lists both `primalUrls` and `primalUrlKey`.
`shared/lib/nostr/nostrTierConfig.ts:81` does build a new array on every render. In the shipped build React
Compiler memoises that array, which is the only thing keeping `runProbes` stable; without it every render
(`useRelayHealth` re-renders the Network screen every 2 s, and each finished probe sets a new `primalHosts` object)
aborts and restarts the probes. The existing test mocks `useNostrTierConfig`, so it cannot see this.
Test: real `useNostrTierConfig`, rerender with unchanged settings, expect no second probe.
**fix**: read the hosts from the key inside `runProbes` and drop `primalUrls` from the array. Latent, not seen
failing.

**I11. Two stores are registered under one name.** `shared/stores/runtime/legProgress.ts:101` creates every
leg-progress store as `{ name: 'legProgress' }`; the `name` option (`'swap'`, `'delete'`) is used only as a log
prefix. `liveStores` and the store-write log therefore hold two entries called `legProgress`. Both are reset on a
switch, so nothing breaks today. **list**: the manifest generator reads the literal, so a per-store name needs a
generator change.

**I12. Three actions end a nearby session the same way.** `shared/stores/runtime/nearPayStore.ts:122-145`:
`resetToPicker`, `complete` and `clear` all set `active: null` and differ only in the log line. **list**: low.

**I13. `shared/hooks/useTransactionLocation.ts` is not a hook.** Its header says "plain async functions, not
hooks"; the hook of that name is in `transactionLocationStore.ts:95`. **list**: move to `shared/lib` with I8.

**I14. The two mempool polls gate differently.** `shared/hooks/useMempoolTxConfirmations.ts` polls only while its
screen is focused and the app is active; `useMempoolAddressSummary.ts:119` runs a 70 s `setInterval` for as long as
the component is mounted, focused or not. **list**: same family as F46.

**I15. The update prompt is named for a forced update that does not exist.** The CTA id is `update-required`
(`shared/lib/cta/definitions.ts:14`) with `presentation: 'dismissable-modal'`, "Update when you're ready" and "Not
now"; `useLatestVersionFetch(blockingUpdateShown)` (`shared/hooks/useLatestVersionFetch.ts:11`). `minVersion` and
`message` are fetched (`shared/lib/apiClient.ts:472-475`), clipped and saved (`settingsStore.ts:164-165, 317-324`),
typed into the CTA context (`cta/types.ts:9`) and read by nothing. **list**: the id is a saved dismissal key; the
owner decides whether a minimum-version gate is wanted or the two fields stop being kept.

**I16. `useMintInfo` parameter type and a redundant guard.** `shared/hooks/useMintInfo.ts:15` is
`string | string | undefined | null`; line 24 re-tests `normalizedUrl` after the early return at 21. **fix**.

**I17. `useNostrProfileMetadata` writes a ref during render beside the helper made to avoid that.**
`shared/hooks/useNostrProfileMetadata.ts:133-134` (`logCtxRef.current = …`), and reads `attempts.current` at 130
and `attempted.current` at 353. `useLatestRef` exists for the first; the file is in
`react-compiler-bailouts.json` ("Cannot access refs during render") and its own comment counts about 30 call
sites. **list**: clearing the bailout needs the attempt counters moved to state, which changes render timing.

**I18. A recorded blob's `purpose` follows the last sighting.** `shared/stores/profile/ownedMediaStore.ts:120`
overwrites `purpose` on every `recordBlobs`; the passive ingest (`:196`) and `useDeletePost.ts:83` pass the default
`'post'`, so an avatar that also appears in a note moves from Avatars to Posts on the media page
(`features/settings/screens/SettingsMediaScreen.tsx:296-297`). The header promises only that `deleteState` is never
downgraded. **list**: saved field; the owner says which label wins.

## 3. Inefficient

**E1. Every own note on every feed page rewrites two whole stores to disk.**
`features/feed/data/naggFeedClient.ts:487-488` (also `useThread.ts:186`, `useOwnEventsSync.ts:173`) calls
`ingestOwnContent` and `ingestOwnMediaBlobs` per page. `ownContentStore.ingestSeen` calls `set` for every own note
and returns the same state when it is already confirmed (`shared/stores/profile/ownContentStore.ts:162-165`);
zustand's persist saves on every `set` whatever it returns (the repo says so itself at
`dmLastMessageStore.ts:54-56`), so each already-known own note costs one `JSON.stringify` plus one AsyncStorage
write of up to 200 notes. `ownedMediaStore.recordBlobs` stamps `lastSeen: now` (`:121`), so each own note with
media also rewrites the never-pruned media ledger. A page of 30 own notes on the profile feed is up to 30 plus N
full saves. Not measured. **list**: guarding `ingestSeen` with `get()` before `set` changes nothing saved; batching
`recordBlobs` or not bumping `lastSeen` does.

**E2. The Network screen re-renders every two seconds.** `shared/hooks/useRelayHealth.ts:41-49` calls `setHealth`
with a new object on every 2 s tick whether or not a status changed. Not measured. **list**: compare before
setting (`useShallowMemo.ts` has the comparison).

**E3. Profile label and balance writes save the whole account list even when nothing changed.**
`profileStore.ts:316-341`: `updateProfileBalance` and `updateProfileMetadata` always `set`; the neighbour
`setWalletDatabaseCreated` (343-348) checks first and says why ("every `set` is a save of the whole list").
`shared/lib/profile/ownProfileSync.ts:43` calls `updateProfileMetadata` for every account on every own-profile
sync. Not measured. **list**: a no-change guard alters no saved value, but `updateProfileBalance` is pinned by
`profileBalanceSync.test.tsx`.

## 4. No longer needed

**N1. `npcMintStore.isSyncing`.** `shared/stores/profile/npcMintStore.ts:17,72`: declared and initialised, never
read or set anywhere (all workspaces, tests, e2e). Not in `partialize`. **fix**: delete the two lines.

**N2. `transactionDistributionStore.getDistribution`.** `shared/stores/profile/transactionDistributionStore.ts:79,
136-138`: no caller (the one `getDistribution(` call in the app is `mintDistributionStore`'s; readers use
`.distributions[key]`). An action, not saved. **fix**: delete it.

**N3. `scrambleFrame`.** `shared/lib/scrambleText.ts:11,18-54`: only `__tests__/scrambleText.test.ts` imports it;
the `ScrambleText` component its header names does not exist in any workspace. Only `SCRAMBLE_DECODE_MS` is used
(`shared/ui/composed/QRCodeFrame.tsx:23`). **fix**: delete the function, `glyphHash`, the charset and the test;
keep the constant.

**N4. `NearPayDelivery`.** `shared/stores/runtime/nearPayStore.ts:8,19`: a type whose only value is
`{ locked: true }`. Two writers set it (`features/nearPay/hooks/useStartNearbySend.ts:64`,
`NearPayScreen.tsx:1812`); every read is a log field (`nearPayStore.ts:72`, `NearPayScreen.tsx:1817,1871`). Left
from when a nearby payment could be unlocked. Runtime only. **fix**: drop the field and type; the commit also
touches the two nearPay files.

**N5. `useKeyedSingleFlight`.** `shared/hooks/useSingleFlight.ts:23-40,67-87`: only its own test calls it.
`docs/review/conventions-async-tests.md:33,51` names it as an accepted guard. **list**: delete with the doc
mention, or keep as the documented per-key guard.

**N6. Saved fields nothing reads.** `settingsStore.quickAccessP2PK` (no setter, no reader);
`walletLifecycleStore.lastRestoreError` (every writer sets `null`, no reader; the comment at `:24` says it is shown
in the restore screen); `wallpaperStore.catalogLastFetched` (written at `:150`, never read);
`ownedMediaStore.lastCheckedAt` (written at `:166`, never read); `recentPeopleStore.firstOpenedAt`;
`transactionDistributionStore` `recordedAt`; `lastKnownAppVersion.minVersion` and `.message` (I15). **list**: all
saved; removing any is the owner's call under the persisted-field rule.

**N7. `settingsStore.language`.** No setter; always `'en'`. Three readers branch on it
(`shared/lib/date.ts:88`, `features/send/providers/Colada.tsx:360`,
`features/send/lib/createSovranScreenActionsBridge.ts:707`). Saved. **list**: belongs with F07.

**N8. `contrastRatio`.** `shared/lib/color.ts:141`: only `__tests__/color.test.ts` uses it, as a helper to assert
on accent colours. **list**: move into the test or keep.

## 5. Regrown

**R1. `errorMessage` now carries three meanings in the leg-progress store.**
`shared/stores/runtime/legProgress.ts:55-61`: pass 2 added `unsettled` and `settleUnknown(detail)` stores its
"what is still pending" text in `errorMessage` (182-183), beside the failure text and the cancel reason. Readers
have to switch on `state` to know which it is. **list**: a tagged run state with its own field per ending.

**R2. `readStrategyFor` has one caller.** `shared/lib/read/readPolicy.ts:48` is used only by
`useCachedRead.ts:161`; the table pass 3 made to be the one place is bypassed by the ten sites in I7. **list**
with I7.

## Not read

Stores: `routstrStore.ts`, `mockDataStore.ts` and the other mock files, `nostrSocialStore.ts`,
`swapTransactionsStore.ts`, `nutDropRedeemQueueStore.ts`, `mintDistributionStore.ts`, `mintMetadataStore.ts`,
`relayMetadataStore.ts`, `mempoolAddressCache.ts`, `btcMapStore.ts`, `wallpaperStore.ts` (searched for members and
callers only).

Hooks: `usePaymentStatusListener.ts` (three excerpts only), `useMempoolAcceleration.ts`,
`useOnchainMeltOutpointDiscovery.ts`, `useAnimatedQrFrames.ts`, `useThemeColor.ts`, `useScreenInsets.tsx`.

Blocks: `popup/PopupHost.tsx`, `popup/ActionMenuHost.tsx`, `status/*`, `transfer/*`, `NativeSplashLayoutGate.tsx`,
`CtaScreen.tsx`, `DrawerProfileChrome.tsx`, `HeaderProfileButton.tsx`, `SovranTabBar.tsx`, `KeyRecoveryScreen.tsx`,
`AccountMismatchScreen.tsx`, `LegalDocumentScreen.tsx`, `NotFoundScreen.tsx`, `StartupFailedScreen.tsx`.

UI: none of the 175 files in `shared/ui` was read. They were covered only by the export count, the suppression
check and knip.

Lib: every `logger*.ts`, `contentShiftLog.ts`, `username.ts`, `apiClient.ts`, `getMintCatalog.ts`,
`migrations/globalMigrations.ts` and `migrateThenLoad.ts` (`dataMigrations.ts` read in part), `cache/*`, `theme/*`,
`map/*`, `nav/*`, `errors/*`, `picker/*`, `http/*`, `format/*`, `e2e/*`, `debug/*`, `legal/*`, `backup/*`, the
popup engine (`popups/index.ts`, `bridge.ts`, `engine.tsx`, `actionMenu*.ts`, the sheets and toast components), and
the remaining top-level files (`url.ts`, `number.ts`, `date.ts` past line 110, `utils.tsx` past line 60,
`imageCache.ts`, `wallpaperStorage.ts`, `wallpaperSync.ts`, `themeEngine.ts`, `color.ts`, `qr*.ts`, `identity.ts`
and the rest).

No single test file was run; the ESLint and knip runs above are the only tool evidence.
