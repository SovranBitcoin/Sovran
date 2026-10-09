# Performance register

Open performance, visual-stability and account-switching issues, each written so it can be picked up
on its own. Nothing here is fixed yet. Compiled 2026-10-09 from a read-only survey of the tree, then
audited the same day by two independent reviewers (Codex on VIS and ACCT, Claude on OBS, CALC and
DEP). Their corrections are merged; where a reviewer's finding was not re-read it says so.

**Confidence labels**

- **Verified** — the cited lines were read and the claim follows from them.
- **Read** — found by code reading during the survey; the cited location was re-checked, the full
  causal chain was not re-traced.
- **Inferred** — plausible from the code, not confirmed. Prove it with a log before fixing.

Nothing in this file was measured on a device. Paths are relative to the repo root.

## Status

Work on this register started on 2026-10-09. An entry below keeps its original wording as the record
of what was found; this table says where each one stands. **Nothing marked done has been run on a
device.** "Done" means implemented, reviewed and covered by tests, with type-check, lint, knip, the
ratchets and the full test suites passing.

| Entries | State |
| --- | --- |
| VIS-1, VIS-2, VIS-4, VIS-5, VIS-6, VIS-7, VIS-8 | Done. The `avatars` log-doctor mode is the regression guard |
| VIS-3 | Done as a bounded loading state: grey until the row's first fetch attempt settles, then the fallback |
| OBS-1, OBS-3, OBS-4, OBS-5, OBS-6, OBS-7, OBS-8, OBS-9, OBS-11 | Done |
| OBS-2 | Done: `store.set` from `defineStore`, with a log-doctor `stores` mode |
| OBS-10 | **Open.** No baseline walk of the 111 pages has been captured; it needs a device |
| CALC-2, CALC-7, CALC-8, CALC-11, CALC-13, CALC-14, CALC-15, CALC-16, CALC-17 | Done |
| CALC-1, CALC-3 | **Open.** Recorded figures only; measure with `coco.call` and the `pages` mode first |
| CALC-4, CALC-5, CALC-6 | **Open, deliberately.** They change how the wallet and the payment-request inbox poll, where a mistake is a missed payment. They need a design decision, not a mechanical fix |
| CALC-9, CALC-19 | **Open.** Unmeasured; `inlineRequires` may already defer CALC-9 |
| CALC-10 | Done with VIS-7 |
| CALC-12, CALC-18 | **Open.** CALC-12 could not be narrowed without changing behaviour |
| DEP-12 | Done |
| DEP-13, DEP-14 and the evaluations (DEP-4 to DEP-7, DEP-9) | **Open** |
| ACCT-9 (registry, enforcement, canary, leak check), ACCT-11 | Done. ADR 0029 |
| ACCT-1, ACCT-2, ACCT-3, ACCT-6, ACCT-7 | Done **inside the opt-in switch only**. Settings has a developer toggle, off by default; with it off a profile switch restarts exactly as before |
| ACCT-4, ACCT-5, ACCT-8 | Holders register a dispose function, which the opt-in switch runs. BLE mesh identity and native state are still unverified |
| ACCT-10 | **Open.** No sign-out or single-profile delete |

Limits of the opt-in switch as it stands:

- It falls back to a restart whenever a Whitenoise or Routstr client is active, because neither has a
  shutdown that can be awaited. Until they do, the fast path will often not be taken.
- The canary test plants an account-A marker in every profile and session store and asserts none
  survives the switch or lands under account B's keys. Of the registered module-level holders, only
  seven can be seeded with a marker; the rest are called without proof that they held account data
  and dropped it.
- If the in-process switch fails and the restart is also unavailable, providers stay suspended and
  writes stay blocked. That is deliberate: a stuck app over a half-switched wallet.
- Real relay shutdown, native cleanup, and what the theme and navigation look like after a switch
  are unproven until it is run on both platforms.

Found by an independent review of the switch and not yet fixed. All apply only with the setting on:

- **A Vertex budget store disables the fast path for the rest of the session.** Creating one records
  a captured storage owner on a registry entry that is never removed
  (`app/shared/stores/profile/vertexBudgetStore.ts:50`), and the switch refuses while any exists. With
  the Whitenoise and Routstr refusals, the fast path may in practice never run yet.
- **The new account's tree briefly sees the old NDK instance.** Teardown clears the signer,
  subscriptions and relays, but ndk-mobile's store still holds the old instance until the new
  provider's deferred init replaces it about 800 ms later. Signing is not possible in that window;
  whether anything reads or writes the old account's cache database through it was not traced.
- **The old account's late writes are dropped.** Writes are blocked before services and the wallet
  core have stopped, so a profile-store update made during teardown (a receive completing, say) is
  never persisted. The old account's blob is intact but can be stale against its wallet database.
- **Only `ndk.pool` is disconnected**, not `ndk.outboxPool`.
- **Navigation is replaced, not reset.** `router.replace('/')` may leave the old account's underlying
  routes and params in the stack. Unverified in expo-router.

## Contents

0. [Status](#status)
1. [What already exists](#1-what-already-exists)
2. [VIS — avatar and banner flicker](#2-vis--avatar-and-banner-flicker)
3. [OBS — observability gaps](#3-obs--observability-gaps)
4. [CALC — known expensive work](#4-calc--known-expensive-work)
5. [DEP — dependency candidates](#5-dep--dependency-candidates)
6. [ACCT — account switching without a restart](#6-acct--account-switching-without-a-restart)
7. [Proposed order of work](#7-proposed-order-of-work)
8. [Not yet enumerated](#8-not-yet-enumerated)

---

## 1. What already exists

Reuse these. The work is coverage and a few missing probes, not a new logging system.

| Piece | Where | Notes |
| --- | --- | --- |
| Structured logger | `app/shared/lib/loggerCore.ts` | JSON entries, dev-only emission, params may be a thunk, `log.timed`, `startSpan`, `initPhase`, 200-entry ring buffer, file sink (`loggerFile.ts`) |
| Package log seams | `wallet/src/logger.ts`, `nostr/src/log.ts` | `setLogger` / `setNostrLogger`, bridged from the app |
| Reader | `app/codereview/log-doctor/` | Modes include `renders`, `screens`, `startup`, `coco`, `perf`, `spans`, `waste`, `tiers`, `reads`, `visual`, `slow`, `network` |
| Render hooks | `app/shared/lib/loggerRender.ts`, `loggerHooks.ts` | `useWhyDidRender`, `useStateChangeLogger`, `useQueryResultLogger`, `useRowRenderLogger`, `useRenderLogger` |
| Per-page mount point | `app/shared/ui/composed/Screen.tsx` | Required `name`; wraps content in `<Log>` (`:249`), which emits `ui.screen` and `ui.screen.diff` (`loggerUI.tsx:101,108`) |
| JS-thread monitor | `app/shared/lib/loggerJsThread.ts` | Opt-in with `EXPO_PUBLIC_JS_THREAD_MONITOR=1` |
| Layout-shift logging | `app/shared/lib/contentShiftLog.ts` | `visual.layout.*` |
| Read lifecycle | `app/shared/lib/read/useCachedRead.ts`, `readLog.ts` | `request / done / applied / render` joined on `readId` (ADR 0008) |
| Query cache logging | `app/shared/lib/cache/createQueryCacheStore.ts` | `query_cache.entry.set`, `run.*`; 11 instances |
| Coco log bridge | `app/shared/lib/cashu/cocoLogger.ts` | Maps coco's internal logs to `coco.<module>.<msg>` |
| Compiler ratchet | `app/scripts/check-react-compiler.mjs`, `app/react-compiler-bailouts.json` | 33 bailing files — the first shortlist for manual render cost |
| Page registry | `app/e2e/schema/pages.ts` | `CANONICAL_PAGES`, 111 pages |
| Prior findings | `app/codereview/optimize/LEDGER.md` | Open items by lens; several are referenced below |

Surfaces that already carry render hooks: contacts, home feed, thread, user feed, user profile, user
messages, mint list / reviews / select flow / info, chat, NearPay. That is 11 of the 111 canonical
pages (see OBS-7).

---

## 2. VIS — avatar and banner flicker

**Symptom:** grey → colourful generated fallback → real image. **Intended:** grey → real image, or
grey → fallback, never both.

**Rule to enforce:** a surface may leave grey only once it knows the final answer.

The primitive is correct: `app/shared/ui/primitives/Avatar.tsx` takes
`state: 'loading' | 'fallback' | 'image'`, and `avatarStateFor(picture, resolved)` in
`app/shared/lib/imageLoadState.ts:28` produces it. The leaks are in what callers pass as `resolved`,
and in the banner.

### VIS-1 — Banner paints an opaque gradient over the loaded image · Verified

- **Where:** `app/features/user/screens/UserProfileScreen.tsx:794-830`; `seededGradientFill` at
  `:724`; colours from `app/shared/lib/avatarGradient.ts` (alpha defaults to 1).
- **What happens:** in the `bannerState === 'image'` branch the tree is `ExpoImage`, then
  `imageGradientColors ? <tint> : seededGradientFill`. `imageGradientColors` is null until
  `useDominantColor` finishes extracting from the picture, so the seeded gradient sits on top of the
  banner until then.
- **Also:** if extraction never yields colours, the gradient stays over the banner. With a picture
  but no banner, the fallback branch (`:832-843`) goes seeded → picture-derived, a second colour
  change.
- **Fix:** in the image branch render the tint only when extracted colours exist, otherwise nothing.
  In the no-banner branch hold grey until extraction settles when a picture exists.
- **Confirm:** log `{bannerState, gradientSource}` on change; `image` with `seeded` is the bug.

### VIS-2 — Feed rows treat a name-only cached profile as resolved · Read

- **Where:** `app/shared/lib/nostr/useEntityCache.ts:63-80` (`useProfile`, status at `:77`).
- **What happens:** status is `record ? 'cached' : pending ? 'loading' : 'absent'`. Feed, thread and
  notification pages seed profiles with a name and sometimes no picture (`seenAt: 0`). A seeded
  record reports `'cached'` even while `pendingProfiles` is set, so the row shows the fallback, then
  the picture when the kind-0 lands. Authors missing from a page report `'absent'` before enrichment
  has started.
- **Fix:** `loading` while `pending`, or while the record is a seed with no picture; `absent` only
  after a fetch has settled.
- **Not confirmed:** how often the feed source returns picture-less profile infos.

### VIS-3 — Contact rows never show the loading state · Read, deliberate

- **Where:** `app/features/contacts/screens/ContactsScreen.tsx:360,416`;
  `app/features/contacts/hooks/useOverlaidContactSearch.ts:88`.
- **What happens:** `isLoadingProfile` is hard-coded `false`, so rows show the fallback until the
  batch metadata read lands.
- **Why it is not a plain bug:** the comment at `:414` says that for strangers a missing kind-0 is
  the steady state, so a skeleton would never resolve. The fix needs a bounded loading state
  (loading until the first fetch attempt settles), not simply wiring `isLoading` through.

### VIS-4 — Callers derive the state by hand, several as two-state · Read

- **Where:** `profile !== undefined` on a feed map in NotificationsScreen, NoteContent,
  StoriesCarousel, BottomPanel, PostComposer; `picture ? 'image' : 'fallback'` in TransactionIcon,
  ZappedPostSection, SignerConnectSheet, `peerAvatarState`. `ListRow` (`:230`) and `IdentityHeader`
  (`:92`) do support a loading state; the gap there is callers that never pass it.
- **What happens:** each has the name-only flaw of VIS-2 or skips loading entirely.
- **Fix:** one shared resolver beside `imageLoadState.ts` taking the record status, and migrate call
  sites. Two-state is correct only for stored accounts (drawer switcher), where the picture is local.

### VIS-5 — Metadata hook settles on the seed · Read (traced by a second reviewer)

- **Where:** `app/shared/lib/nostr/fetchProfiles.ts:49`; `nostr/src/facade/data-layer.ts:450`;
  `app/shared/hooks/useNostrProfileMetadata.ts:161`.
- **What happens:** the aggregate can paint on a partial answer from one source. `getProfiles`
  returns `{ ...cachedMeta, ...tierProfiles }`, so a name-only seed is present under the pubkey's
  key. The flight returns as soon as the key exists (`Object.hasOwn`), skipping the wait for
  remaining sources that the next lines provide, and the hook marks the pubkey resolved. The
  fallback shows until a later tier ingests the picture.
- **Fix:** do not treat a key supplied only by `cachedMeta` as an answer while
  `pendingProfiles.has(key)`.

### VIS-6 — Avatar resets load status one commit late · Read

- **Where:** `app/shared/ui/primitives/Avatar.tsx:186-191`.
- **What happens:** `imageStatus` resets in an effect on `picture` change. A recycled list cell whose
  previous status was `'failed'` renders the fallback for one commit (`:275`). `loadedPicture` is
  never cleared, so a reused instance can draw the previous URL behind the new one (inferred: only
  when the same component instance is reused for another identity).
- **Fix:** derive the status from the picture URL during render instead of resetting in an effect.

### VIS-7 — Tier-fetched profiles are always stale, so they refetch on every mount · Read

- **Where:** `nostr/src/facade/cache/ingest.ts:27,80-82` (`ingestProfiles` writes
  `seenAt = DIRECT_METADATA_SEEN_AT`, the constant `1`);
  `app/shared/stores/global/nostrMetadataCache.ts:152` (`fetchedAt: record.seenAt ?? 0`); readers at
  `app/shared/hooks/useNostrProfileMetadata.ts:311` and `app/shared/lib/nostr/useEntityCache.ts:231`.
- **What happens:** `seenAt` is used as a merge rank (0 for seeds, 1 for a direct fetch), but both
  readers subtract it from `Date.now()` as if it were a timestamp. `Date.now() - 1` always exceeds
  the 24-hour TTL, so a profile fetched through the tiers is stale the moment it lands.
- **Exception:** `ingestResolvedProfiles` (`useEntityCache.ts:240`, used for the own profile and in
  the send provider) writes real milliseconds, so those records are fresh for 24 hours.
- **Correction to an earlier draft:** this is not a seconds-versus-milliseconds mix; no production
  writer stores seconds.
- **Fix:** keep rank and fetch time as separate fields.
- **Still to measure:** how many refetches this causes per session (the hook's retry window limits
  repeats within one mount, not across mounts).

### VIS-8 — No regression guard · Verified gap

Existing tests cover pieces: `useNostrProfileMetadataResolving` exercises async resolution and
retries, `useProfileRecordsMany` exercises `useProfile`, `imageLoadState` and `avatarFallback` check
static states. None asserts the full visual sequence a row goes through, and none covers the banner. Add a dev-only
`visual.avatar.sequence` log on branch change and a log-doctor check that fails on
`loading → fallback → image` for the same seed.

---

## 3. OBS — observability gaps

Duplicate fetching is expected and out of scope. The gap is what happens to data after it arrives.

| Id | Gap | Where to add it once | Confidence |
| --- | --- | --- | --- |
| OBS-1 | Entity-cache writes are unlogged: no count of keys written, keys actually changed, or listeners notified | `nostr/src/facade/cache/store.ts` — `createNormalizingStore`, `notifyKey` / `notifyGlobal` (`:89-96`), batch path (`:153-158`) | Verified |
| OBS-2 | Zustand stores have no shared write logging (changed keys, subscriber count) | A middleware applied through the store factory proposed in ACCT-9 | Read |
| OBS-3 | Coco calls are not timed centrally; `manager.*` is called directly from about 36 app files (a first count of 85 was files importing any coco package) | A timing proxy at the `CocoManager` manager getter (`app/shared/lib/cashu/manager.ts`) and around `createSovranCocoRepositories` (`cocoRepositories.ts:203`). No coco patch (ADR 0017) | Read |
| OBS-4 | No UI-thread frame-drop monitor | Beside `loggerJsThread.ts` | Read |
| OBS-5 | No navigation timing (route change → first commit → settled) | `Screen.tsx` plus a router listener | Read |
| OBS-6 | Two screens bypass both `Screen` and `<Log>`: `NearPayPeerListScreen` (lifecycle logger only, `:63`) and `ReceiveRailListScreen`. FlowCamera and Stories use `<Log>` without `Screen`. A first list of 15 was wrong: the send and receive screens are covered through `TransactionDetailShell`, an aliased `Screen` import, or a parent screen | Move the two onto `Screen` | Read, two spot-checked |
| OBS-7 | 100 of 111 canonical pages have no render hook in their screen component. By area: settings 27, launch and shell 13, receive 9, signer 9, feed and social 8, send 7, backup and recovery 6, mint 5, transactions 5, AI 3, theme 3, chat 2, map 2, camera 1. Wallet home and the profile switcher have a hook only in a shared child | Mount `useWhyDidRender` in `Screen.tsx` keyed by `name`; add `useRowRenderLogger` to their lists | Read (second reviewer's count, not re-counted) |
| OBS-8 | Nothing enforces coverage, so new pages arrive uninstrumented | A ratchet script over `CANONICAL_PAGES`, in the style of `check-react-compiler.mjs` | Verified gap |
| OBS-9 | No per-page scorecard and no ingest fan-out view | New log-doctor modes: `pages` (mount ms, renders, dropped frames, coco ms, store writes) and `ingest` (write → notify → render) | Read |
| OBS-10 | No baseline to compare against | One scripted walk of all 111 pages through the JSON e2e harness in mock mode, saved as the baseline | Verified gap |
| OBS-11 | Derived calculations are timed ad hoc only | A `log.timed` wrapper for selectors and list transforms, starting with the CALC items | Read |

Constraints for all of the above: emission is dev-only but params are not, so pass a thunk whenever
building them costs anything; never log secrets (`secrets/logs` in
`docs/review/contributor-conventions.md`); instrumentation overhead is itself a known cost
(`docs/architecture/thermal-investigation-2026-09-09.md` §6), so the frame and JS-thread monitors
stay opt-in.

---

## 4. CALC — known expensive work

Already visible in existing logs or the optimize ledger. Figures are from recorded examples, not
re-measured.

| Id | What | Where | Evidence |
| --- | --- | --- | --- |
| CALC-1 | History filter predicate ran about 1.4k times in one session — **possibly stale**: the figure is from a v0.1.0 sample log and no emitter of this event was found in current source | `history.filters.matchesFilters` | `app/codereview/log-doctor/OVERVIEW.md:240` (1392 calls) |
| CALC-2 | Transaction list filter exceeds 20 ms | `app/features/transactions/components/Transactions.tsx:320-322` | Existing `transactions.filter.slow` warning; 51.56 ms recorded at `OVERVIEW.md:248`. `history` is also filtered twice with `belongsToAccount` (`:270,280`) |
| CALC-3 | Receive recovery dominates wallet init | `Coco-bg.receiveRecovery` | `OVERVIEW.md:261` (13.9 s) |
| CALC-4 | Coco polls over HTTP every 5 s after a websocket drop, for the life of the pending state | `app/shared/lib/cashu/manager.ts` (subscriptions config) | LEDGER, open P1 |
| CALC-5 | NPC sync re-arms every 25 s regardless of socket health or app state | `app/shared/lib/cashu/npc.ts` | LEDGER, open P1 |
| CALC-6 | Payment-request inbox polls every 15 s with a 30 s default timeout | `app/shared/lib/cashu/paymentRequestNostrTransport.ts:43` | LEDGER: the refetch of an identical page every 15 s (no cursor) is open **P0**; the timeout is P1. Earlier sessions recorded many ticks with nothing ingested |
| CALC-7 | Every notifications update creates all-new item objects, so every mounted row re-renders | `app/features/feed/data/facadeNotificationsAdapter.ts` | LEDGER, open P1 |
| CALC-8 | Mint list `renderItem` identity churns when `isExecuting` flips | `app/features/mint/screens/MintListScreen.tsx` | LEDGER, open P1 |
| CALC-9 | marmot-ts is imported unconditionally by a root provider. Whether it is evaluated at launch is unproven: `inlineRequires` is on (`app/metro.config.js:133`), which defers evaluation to first use | `app/features/whitenoise/WhitenoiseProvider.tsx` | LEDGER, open P2 |
| CALC-10 | Tier-fetched profile metadata is always stale, so it refetches on every mount | See VIS-7 | Mechanism read by two reviewers; network cost unmeasured |

Found by the second review, not yet in the ledger. Costs are unmeasured; "inferred" marks an assumed
consequence.

| Id | What | Where | Evidence |
| --- | --- | --- | --- |
| CALC-11 | Each consumer of the many-profiles hook loops all its pubkeys on every cache write, and each `get` re-inserts the key for LRU order | `app/shared/lib/nostr/useEntityCache.ts:127-156`; `nostr/src/facade/cache/store.ts:130-134` | Bailout file |
| CALC-12 | Engagement getters depend on five whole maps, so one like changes every getter's identity | `app/features/feed/hooks/useNostrEngagement.ts:205-213,426-474` | Bailout file; row re-render inferred |
| CALC-13 | Selector counts keys on every social-store update | `app/features/feed/components/HomeFeed.tsx:263` (`Object.keys(s.followingPubkeys).length`) | Spot-checked |
| CALC-14 | Notifications `renderItem` is inline and hands every row the whole result plus a new object | `app/features/feed/screens/NotificationsScreen.tsx:532-552` | Compounds CALC-7 |
| CALC-15 | Inline `renderItem` and index keys | `NotificationFollowersScreen.tsx:206`; `StoriesCarousel.tsx:297,650`; `UserProfileScreen.tsx:526` | |
| CALC-16 | Contacts list invalidates every row when the profiles map changes | `app/features/contacts/screens/ContactsScreen.tsx:581,601` (`extraData={profilesMap}`) | Map churn inferred |
| CALC-17 | Mint contacts fetch info for every mint on mount | `app/features/payments/hooks/useMintContacts.ts:60-73` | Bailout file |
| CALC-18 | `getActiveProfile()` used inside selectors scans the profile list on every store update | `app/shared/stores/global/profileStore.ts:261`; `app/features/bitchat/hooks/useBitchatNickname.ts:16` and four more call sites | Bailout file |
| CALC-19 | Synchronous work before the router entry: two e2e installers and two polyfill installs | `app/index.js:6,12`; `app/shim.js:21-23` | Cost unmeasured |

---

## 5. DEP — dependency candidates

`bun run knip` exits clean, so nothing here is flagged automatically. Each is a judged change and
needs both Metro platform bundles built. Import counts are from grep over source. DEP-12 to DEP-14
come from the second review and were only partly re-checked.

| Id | Package | Evidence | Verdict |
| --- | --- | --- | --- |
| DEP-1 | `expo-screen-corner-radius` | No import, but loaded by name: `requireOptionalNativeModule('ExpoScreenCornerRadius')` in `app/shared/lib/screenCornerRadius.ts:12` | **Keep.** Removing it would silently fall back, not fail |
| DEP-2 | `react-dom`, `react-native-web` | No app imports; `react-native-web` is used in two tests; `app/app.json` has a `web` block and `app/app/+html.tsx` exists | Keep while web and those tests stay |
| DEP-3 | `qrcode` + `react-native-qrcode-svg` | `react-native-qrcode-svg` itself depends on `qrcode` | **Not a duplicate.** Dropping the direct dependency saves nothing |
| DEP-4 | `@shopify/react-native-skia` | 4 source files (two NearPay components, `boltSkiaPath`, `ProfileTierRing`); install size of about 734 MB reported once, not re-measured | Evaluate replacing the four uses; needs a device check |
| DEP-5 | `react-native-image-colors` | 1 file (`colorExtraction.ts`, `cache: true`); drives VIS-1. Whether it downloads the image a second time is unproven | Evaluate alongside the VIS-1 fix |
| DEP-6 | `react-native-webview` | 1 file (`LinkEmbedView`) | Evaluate; device check |
| DEP-7 | `react-native-pager-view`, `@react-native-menu/menu` | Pager: 2 files. Menu: two `.liquid.tsx` files only | Evaluate; HeroUI Menu is the canonical pick-one surface |
| DEP-8 | `npubcash-sdk` | `npc.ts`, `ClaimUsernameScreen.tsx` | Keep |
| DEP-9 | `jsdom` (dev) | Test environment for two `SendScreen` tests | Removable only by rewriting both |
| DEP-10 | `@internet-privacy/marmot-ts` | Needed; see CALC-9 | Measure before deferring |
| DEP-11 | `@babel/runtime`, `react-native-nitro-modules` | Nitro is a peer of `react-native-quick-crypto`; `@babel/runtime` is mapped in `jest.config.js` | Keep |
| DEP-12 | `@noble/curves` | Listed under devDependencies (`app/package.json:192`) but imported at runtime (`app/features/nearPay/lib/nearbyCapability.ts:3`) | **Move to dependencies.** Correctness, not size |
| DEP-13 | `react-native-quick-base64`, `tailwind-variants` | Reported as peers of `react-native-quick-crypto` and heroui-native that are not declared | Check and declare |
| DEP-14 | `cborg`, `network-timeouts`, `expo-dev-client`, `expo-build-properties` | No source imports. `cborg` appears only in a Jest mapper; `network-timeouts` is an iOS native module; the Expo two are tooling or plugins | Only `cborg` is a removal candidate; check first |

Single-import packages worth a glance when touching their one caller: `pako` (`zlibShim.ts`),
`expo-mesh-gradient`, `expo-sensors`, `tailwind-merge`, `react-native-fast-squircle`.

After review, **no package is a confirmed safe removal.** The dependency work is smaller than first
thought: one misplaced dependency (DEP-12), possibly undeclared peers (DEP-13), and a handful of
single-use native packages to weigh.

Record outcomes in `docs/architecture/dependency-surface-audit.md`.

---

## 6. ACCT — account switching without a restart

**Today:** `app/shared/lib/profile/profileSessionOrchestrator.ts` tears down coco and Routstr,
writes the target profile to disk, then calls `restartApp()` (`appRestart.ts:20` —
`DevSettings.reload()` in dev, `RNRestart.restart()` in production). The restart is what guarantees
isolation.

**What already helps:** `app/app/_layout.tsx:415` keys `AccountScopedProviders` by account index, so
the React tree (Nostr keys, NDK, signer, Whitenoise, Coco, wallet context, the navigation stack)
remounts on a switch. Zustand stores and module-level singletons live outside React and do not.

Ranked by danger, wallet and keys first.

### ACCT-1 — Profile-scoped stores keep the old account's memory · Verified mechanism

- **Where:** `app/shared/lib/cashu/profileScopedStorage.ts:95-119`.
- **What happens:** the storage adapter resolves the active pubkey on every read and write, but each
  store hydrates once at module load. After an in-process switch, account A's in-memory state is
  written under account B's key on the next `set`. About 29 stores, including the Nut Drop redeem
  queue (bearer tokens), `mintStore`, `swapTransactionsStore`, `routstrStore` and the NIP-46
  connection store.
- **Already documented:** `persist/rehydrate-reset` in `docs/review/conventions-state.md` describes
  this and exempts flows that restart the runtime.
- **Fix:** on switch, block persist writes, reset each profile store to its initial state, flip the
  account, then rehydrate under the new key.

### ACCT-2 — Coco cleanup can be abandoned mid-flight · Read

- **Where:** `profileSessionOrchestrator.ts:145-147` (`COCO_CLEANUP_TIMEOUT_MS = 5_000`).
- **What happens:** harmless when a restart follows; in-process, the new manager could start while
  the old one is still closing its database.
- **Fix:** await cleanup to completion; on timeout fall back to the restart path.
- **History:** an in-memory flip before restart once double-booted coco (BTC-13); an unbounded NPC
  sync once pinned the switch (BTC-14).

### ACCT-3 — The old NDK instance, signer and relay pool are never disposed · Read

- **Where:** `app/shared/providers/NostrNDKProvider.tsx:144`;
  `node_modules/@nostr-dev-kit/ndk-mobile/dist/module/stores/ndk.js:16`.
- **What happens:** the provider's cleanup only clears a timer. On re-init ndk-mobile creates and
  connects a new NDK and replaces the global reference without disconnecting the old one or clearing
  its signer. Hook-owned subscriptions do stop on unmount, so not every subscription survives.
- **Not observed:** whether the orphaned instance actually keeps signing or receiving. Its
  connections and signer stay alive either way.
- **Fix:** disconnect the pool and drop the signer explicitly in the provider's cleanup.

### ACCT-4 — Decrypted DMs stay in memory · Read

- **Where:** `app/shared/lib/cache/createPubkeyScopedCache.ts` (`evictFromMemory` at `:266` has no
  callers); the gift-wrap cache built on it; `pendingZapStore`.
- **What happens:** entries are keyed by pubkey so they are not misattributed, but account A's
  plaintext remains readable in memory while B is active.

### ACCT-5 — Root seed and mnemonic cached for the process lifetime · Read

- **Where:** `app/shared/lib/nostr/keyDerivation.ts:13-14` (`_cachedMnemonic`, `_cachedRootSeed`).
- **What happens:** never zeroed. Low cross-account risk for derived accounts, which share the root,
  but it matters for imported-key accounts and for general key hygiene.

### ACCT-6 — Query caches and the cache session epoch are retained · Read, lower risk than first written

- **Where:** `app/shared/lib/cache/cacheSession.ts:12` (`const epoch = 1`, documented as resetting on
  the reload); `clearAllQueryCaches()` in `createQueryCacheStore.ts` is called only by delete-all.
- **What happens:** entries and the epoch survive an in-process switch. Reads through
  `useCachedRead` are already safe: an entry whose `viewerKey` differs is treated as absent
  (`app/shared/lib/read/useCachedRead.ts:172-179`). The remaining risk is memory retention, the
  epoch's cold/warm decision being wrong for the new account, any cache consumer that bypasses
  `useCachedRead`, and the feed, thread and notification seed Maps.
- **Fix:** bump the epoch and clear profile-scoped caches on switch.

### ACCT-7 — Memory-only stores with no reset · Read

`sendLockStore`, `amountDraftStore`, `contactSendStore`, `composerStore` and most of
`app/shared/stores/runtime/*` (about 17, with ad hoc `clear` on roughly half). A half-entered amount
or draft from account A would appear under B.

Already handled, so not part of this: NIP-46 requests are cleared when the signer service unmounts
(`app/features/nostrSigner/lib/nip46Engine.ts:923`), and `dmEchoStore` keys echoes by viewer
(`app/shared/stores/runtime/dmEchoStore.ts:46`).

### ACCT-8 — Smaller holders · Read / Inferred

- Routstr client: the orchestrator skips the explicit reset on create-and-switch, but the client
  rebuilds itself when the storage owner changes (`app/shared/lib/routstr/sdk/client.ts:80-85`), so
  this is low risk.
- BLE mesh identity (`BitChatModule` lifecycle and leases; native state unverified).
- Nut Drop auto-redeem orchestrator (guarded by a manager identity check, never disposed).
- `cacheByViewer` in `nostr/src/facade/relay/for-you/build.ts`.
- Module caches in the AI, mint-management, zap and publish paths.
- Navigation state: the remounted stack may restore the old account's routes (inferred).
- `ThemeProvider` sits above the remount boundary but reads a profile-scoped store.
- Image cache is never cleared and not account-keyed (cosmetic).

### ACCT-9 — There is no single registry, so nothing stops the next leak · Verified gap

This is the forward-running problem.

- `persistConfig()` (`app/shared/lib/persist/persistConfig.ts`) already registers nearly every
  persisted store in `persistRegistry`, but records no scope and no store handle.
  `createQueryCacheStore` bypasses it with its own registry.
- There is no store factory; about 68 stores call zustand `create` directly, and no lint rule governs
  store creation or scope.
- Hand-kept lists have already drifted: `PROFILE_SCOPED_STORE_KEYS` lists `'feed-cache'`
  (`profileScopedStorage.ts:154`) while the store is named `'feed-page-cache'`
  (`app/features/feed/data/feedCache.ts:14`); `app/shared/lib/debug/storageInventory.ts` is stale
  too.
- No test enumerates all state holders. `profileSwitchOrdering.test.ts` covers ordering only.

**Proposed shape:**

1. One `defineStore` factory with a required `scope: 'global' | 'profile' | 'session'`, recording
   the handle and initial state; query caches register into the same registry.
2. `registerAccountScoped(name, dispose)` for module singletons and Maps.
3. An ESLint ban on importing zustand `create` outside the factory (`app/eslint.config.js`), and
   derive the hand-kept key lists from the registry.
4. A canary test that fills every registered holder with an account-A sentinel, runs the switch, and
   asserts no sentinel remains in memory or under B's storage keys — a new store is covered
   automatically.
5. A completeness test: every `create(` call and every persisted key is in the registry.
6. A dev-only leak detector that scans stores and storage keys for the previous pubkey after each
   switch.
7. Ship the in-process switch behind a dev setting; keep `restartApp()` as default and fallback until
   the canary passes on both platforms. Record the decision as an ADR.

### ACCT-10 — Missing flows · Read

There is no sign-out and no single-profile delete; `deleteAllProfiles` wipes everything. Any new
teardown path should serve these too.

### ACCT-11 — Further module-level holders found by a second reviewer · Read, spot-checked

Holders outside React with no teardown. "Survives" means across a keyed remount alone.

| Holder | Where | Holds | Survives |
| --- | --- | --- | --- |
| `inFlight` | `wallet/src/quotes/reusable.ts:70` | In-flight standing-quote promises; unlike the neighbouring `resolvedCache`, the key is not scoped by manager, so a flight could be joined across accounts | Until settled |
| `memoizedSeed` closure | `wallet/src/wallet-seed.ts:146` | Cashu seed; no zero or dispose | While retained |
| `services` | `app/features/nearPay/lib/nearbyPayments.ts:70` | Owner-bound delivery services and pending work | While owner retained |
| `encodeCache` | `app/features/ai/lib/attachments.ts:42` | Private attachment data URLs | Yes |
| `reviewed` | `app/features/payments/lib/dmEcashRecovery.ts:27` | Owner/token review decisions | Yes |
| `attempted` | `app/shared/lib/nostr/vertex/refreshVertex.ts:21` | Owner/day search text and lookup targets | Yes |
| `stores` | `app/shared/stores/profile/vertexBudgetStore.ts:61` | Per-owner budget stores | Yes |
| `reconcilingActions` | `app/features/feed/hooks/useNostrEngagement.ts:54` | Engagement-flight guards, unscoped | Until settled |
| `inFlight` | `app/features/feed/hooks/useDeletePost.ts:30` | Pending own-post deletion ids | Until settled |
| Turn maps | `app/features/ai/lib/turnErrors.ts:41`, `turnTruncation.ts:29` | AI message errors and truncation details | Yes |
| `attempted` | `app/shared/hooks/useNostrPersonDisplay.ts:24` | Lookup history that suppresses later attempts | Yes |
| `lastTarget` | `wallet/src/melt-target.ts:18` | Last payment destination and its classification | Yes |

Only the first row was re-read after the review; the rest are as reported. All belong under
`registerAccountScoped` in ACCT-9.

---

## 7. Proposed order of work

1. **Flicker (VIS).** Causes are identified; fix VIS-1 to VIS-7 (VIS-3 needs a design
   choice first), add the guard in VIS-8.
2. **Observability (OBS).** The four missing probes, then `Screen.tsx` coverage, the ratchet, the two
   log-doctor modes and the baseline walk. Fixes are then chosen from the scorecard, worst first.
3. **Dependencies (DEP).** Small after review: DEP-12 and DEP-13 first, the rest are evaluations.
4. **Account switching (ACCT).** Registry and enforcement first (ACCT-9), then the switch sequence,
   then the proofs. OBS-2 comes for free from the factory.

Each phase is independently shippable.

## 8. Not yet enumerated

- **Module-level state.** A pattern search found about 220 top-level declarations; state that is
  indented, wrapped in an object, or class-static (other than `CocoManager`) was not caught. ACCT-9
  step 2 needs a proper audit.
- **Package internals.** ndk-mobile, coco-core and the NPC plugin were not read.
- **Native state.** iOS and Android bitchat and NFC modules.
- **Component-level timers and listeners.** About 50 were assumed to end with their effect on
  remount; not individually checked.
- **Measurements.** No device run; every number here comes from earlier recorded logs or from code
  reading.
- **Second-review limits.** The reviewers' page count (OBS-7), most ACCT-11 rows, CALC-11 to
  CALC-19 and DEP-13 to DEP-14 were spot-checked, not fully re-read. OBS-2, OBS-9 and OBS-10 were
  not independently checked by either reviewer.
- **Discovery tooling.** `jg` returned no output during the survey, so discovery used grep and file
  reads; a semantic pass may surface more.
