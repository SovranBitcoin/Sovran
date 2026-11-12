# Pass 3 survey: messaging, signer, AI and map

Area: `app/features/bitchat` (with the bridge `app/modules/bitchat-module/src` and
`app/shared/providers/BitchatBLEProvider.tsx`), `app/features/whitenoise`, `app/features/nostrSigner`,
`app/features/ai` with `app/shared/lib/routstr`, `app/features/map`.

Checkout `sovran-surgery`, branch `surgery/pass-3`. Paths are relative to `app/` unless they say otherwise.
"Traced" means followed through the code; nothing in this survey was run except `bun run knip` (clean: it reports
nothing, and it ignores `modules/**` and counts test imports as use, so it cannot see the dead surface below). No
test file was run. Export counts come from a grep of every exported name against non-test files.

Pass 2 rewrote `useWhitenoiseDM.ts`, `bitchatDmMessages.ts`, `ai/lib/turns.ts` and `useAiSend.ts`, and deleted
`routstr/topUp.ts` (the AI top-up branch of Send). The candidates below touch those only where an interface is
plainly wider than its callers, or where the deletion left dead code behind.

## Ranking

| # | Candidate | Deletes (product, rough) | Obligation removed | Risk | Size |
| - | --------- | ------------------------ | ------------------ | ---- | ---- |
| 1 | BitChat surface no app code calls | ~360 lines, ~200 test lines | none (dead) | none; native unchanged | S, mechanical |
| 2 | Routstr API-key leftovers after the top-up deletion | ~200 lines, ~150 test lines move | two key parameters threaded through every read | money-adjacent, unreachable | M, mechanical |
| 3 | `useBitChat` as one transport table, bubble-ready rows, retry inside | ~80 net | screen casts, rebuilds status, owns the retry set | lost text (F183), none stored | M |
| 4 | AI "the model a send goes to": one owner | ~40 | three screens re-derive it, one from the wrong balance (D2) | which model is paid: keep inputs identical | S–M |
| 5 | Signer: ending a client's session, one owner | ~10, closes D4 | revoke grants + allows + throttle at three sites | signing permissions | S |
| 6 | Map: camera and markers as one hook | ~50, closes D1 | "after setCamera call updateMarkersForCamera", forwarder ref | none | M |
| 7 | White Noise context: per-account storage, network owns relay fallback | ~40 | `new WhitenoiseDmIndex(accountIndex)` ×4, relay fallback ×5 | wire (group relays): keep the constant | M |
| 8 | Signer hot flag as leases (F225) | ~15, closes D10 of pass 2 | "the surface that set it resets it" at four writers | signer goes cold | S–M |
| 9 | Signer surface only tests use | ~55, ~60 test lines | none (dead) | none | S, mechanical |
| 10 | BLE start request: one builder | ~25 | three identity hooks + `|| 'sovran'` at each start | BLE announce nickname: identical in practice | S |
| 11 | Blocked-conversation guard for the three DM screens | ~25 | blocked selector, empty list, disabled composer, banner copy, send re-check ×3 | none | S |
| 12 | `useWhitenoiseDM` returns its phase | ~20 | screen rebuilds a four-way phase from five flags | none | S |
| 13 | White Noise provider teardown: one `close(mode)` | ~40 | `inProcessProfileSwitch` branch in two effects, `disposeSigner` beside `shutdown` | key zeroing | M |
| 14 | White Noise setup: one owner per account | ~0 net, closes D7 | each hook instance counts and bootstraps alone | key packages published twice | S–M |
| 15 | `BluetoothNotice` takes the state it is always given | ~6 | none; drops two unused native subscriptions per notice | none | S, mechanical |

Considered and left: folding the signer engine's `pendingContexts` map into the request store entry, which would
delete `VerdictResolverSeam.takeContext/deleteContext` (`lib/verdictResolver.ts:70-89`, a single-adapter seam with no
test double; the engine is its only adapter). Pass 2 deferred it; the gain is still about 30 lines in the most
security-sensitive file of the area, and `nip46Engine.test.ts` pins every removal path. `useAiSend` itself (1,382
lines, rewritten in pass 2) and the Routstr paid attempt (`sdk/client.ts`) were not reopened.

---

## 1. BitChat surface no app code calls

**Module and callers.** Production callers: 0 for each.
- `features/bitchat/lib/blePrivateDelivery.ts` (177 lines: `chunkUtf8`, `sendBLEPrivateMessageChunks`, the
  injectable `deps`). Only `__tests__/bitchatBlePrivateDelivery.test.ts` (145 lines) imports it; it was dead on
  `main` (`e5d70b590`) too. Both real private senders call the bridge directly without chunking
  (`features/nearPay/lib/nearbyPayments.ts:367`, `features/nearPay/hooks/useNearbyDiscovery.ts:226`,
  `features/bitchat/hooks/useBitChat.ts:506`).
- Bridge wrappers in `modules/bitchat-module/src/BitChatModule.ts` with no app caller (grep outside the module, tests
  included): `resetBLEPrivateChat` (:220-229; only a comment in `useBitChat.ts:485` names it), `sendBLEFavorite`
  (:264-273), `addBLEPeerIdentityListener` (:275-285), `getBLEDmHistory` (:303-311), `bitchatVendorVersion` (:317-326),
  `addBLEBackgroundTaskExpiringListener` (:362-371), `leaveGeohash` (:411-413, named only in comments). With them:
  their barrel lines in `modules/bitchat-module/index.ts`, `readBLEPeerIdentity` and `readBLEBackgroundTaskExpiring`
  (`src/nativeEvents.ts:87,132`), the types `BLEPeerIdentityEvent` and `BLEDmContact` (`src/types.ts:98,164`).
- `useBitchatDmMessagesStore.getForPeer` and `clearForPeer` (`stores/bitchatDmMessages.ts:157-159,363-376`): only
  `__tests__/bitchatDmMessages.test.ts:74,147` call them.

**Obligation today.** None; the cost is reading. Several doc comments claim uses that do not exist:
`bitchatVendorVersion` "Logged at startBLE" (`BitChatModule.ts:318`), `BLEDmContact` "used to surface peers ... in
the Contacts screen's Recent / All tabs" (`types.ts:160`), `resetBLEPrivateChat` "Use this when the JS-side watchdog
detects a stuck `sending` message" while the watchdog deliberately does not (`useBitChat.ts:485-493`).

**Proposed shape.** Delete them. The native methods stay on the native side (the TS interface
`BitChatNativeModule` can drop the matching members or keep them; nothing calls them either way). Keep `chunkUtf8`'s
knowledge in one line of the bridge's `sendBLEPrivateMessage` doc if the 254-byte TLV limit still matters (its
comment says `0xFF` selects an extended TLV, which the unchunked nearby payments already rely on).

**Deletion test.** Nothing is lost: no code path reaches any of it.

**Deletes.** About 177 + 110 + 25 + 25 + 20 = ~360 product lines; tests: `bitchatBlePrivateDelivery.test.ts`
whole, two cases of `bitchatNativeEvents.test.ts` (:103, part of :141), two of `bitchatDmMessages.test.ts`
(rewrite `thread()` to read `byPeer`). Net down.

**Risk.** None stored or sent. Confirm on the native side only that no native code expects JS to call
`leaveGeohash` (the comment at `useBitChat.ts:89` says full teardown calls it natively).

**Pins.** No pin is needed for dead code. `bitchatNativeEvents.test.ts` keeps pinning the readers still used.

**Size.** S. Mechanical.

---

## 2. Routstr API-key leftovers after the top-up deletion

**Module and callers.** `shared/lib/routstr/api.ts`: `checkBalance` (:955-1012), `applyResponseChange` (:515-526),
`BalanceSpine` and `BalanceResponse` (:327-341), the `requestKey`/`balanceKey` parameters of
`readRoutstrEnvelope` (:838-846) and `throwResponseError` (:680-684), and the 401 archive and 402 balance-sync
branches inside `throwResponseError` (:703-744). `shared/stores/profile/routstrStore.ts`: actions `setApiKey`,
`clearApiKey`, `applyChangeToken`, `setBalance`, `clearBalance` (interface :564-576, bodies :1209-1262).

Production callers of `checkBalance`: 0 (the two grep hits are comments, `AiMessageBubble.tsx:149` and
`routstrStore.ts:261`). Its only caller was `routstr/topUp.ts`, deleted in pass 2 (`git show
e5d70b590:app/shared/lib/routstr/topUp.ts` calls `checkBalance` at :64,:80 and `setApiKey`/`setBalance` at
:57,:83,:96). The other callers of the two readers pass no key: `getModels` (`api.ts:919`) and `sendMessage`
(`api.ts:1689`, `throwResponseError(response, undefined, undefined, ownsScope)`). So with no key, the 401 branch
(`requestKey != null`) and the 402 branch (`balanceKey != null`) are unreachable, and `applyChangeToken`,
`clearApiKey`, `clearBalance`, `setBalance` are reached only from them. `setApiKey` has no caller outside tests.

**Obligation today.** Every Routstr read carries two optional key parameters and a scope check written for a mode
the app no longer sends in; a reader of `throwResponseError` has to work out that half of it cannot run. The
persisted `balance` field is now written by nothing, yet `AiChatScreen.tsx:168` still reads it (D2).

**Proposed shape.** Delete `checkBalance`, `applyResponseChange`, `BalanceSpine`, `BalanceResponse`, the two key
parameters and both branches; `readRoutstrEnvelope(response, spine, meta, ownsScope)` and
`throwResponseError(response, ownsScope)`. Delete the five store actions. **Keep the saved fields** `apiKey`,
`balance`, `legacyAccounts` and their schema exactly (`routstrStore.ts:1091,1114-1115`), and keep the repoint archive
(`routstrStore.ts:1483-1490,1588-1595`) and `reclaim.ts`, which is how a bearer key a release once wrote is still
swept back. `BalanceEvidenceSchema` and `isWalletBalanceError` stay: `sendMessage` errors use them.

**Deletion test.** Nothing reaches the deleted code; the only behaviour they pin is the API-key era's.

**Deletes.** About 63 + 12 + 19 + 45 + 10 in `api.ts`, ~45 in the store: ~200 product lines. Tests:
`routstrChangeHeader.test.ts` drives the change header through `checkBalance` (:77,:148-193) and `sendMessage`
(:197-240); the `checkBalance` half goes. `routstr402BalanceSync.test.ts` uses `checkBalance` as the vehicle at
:140,:153,:162,:245; the "402 → balance truth-sync" block goes, and the cases that pin `isWalletBalanceError` and
error evidence (:180-224, :249-362) move to `sendMessage` or `describeError`. Five AI test files list
`checkBalance` in their `jest.mock` of the API; that key is removed. Net down.

**Risk.** Money-adjacent: the API key is a bearer instrument. Nothing that stores, archives or reclaims it changes;
only the code that could act on a live key in a response is removed, and no request carries one. Out of scope if a
reviewer finds any request still sent with `Authorization: Bearer <apiKey>` (only `reclaim.ts:57` does, and it does
not use these readers).

**Pins before the cut.** `routstrReclaim.test.ts`, `routstrAccountArchive.test.ts`, `routstrSecurePersistence.test.ts`,
`routstrStorePersistResilience.test.ts` must stay green unchanged; that is the proof the bearer-key handling a release
can hold is untouched. Add one pin that `sendMessage`'s 402 path never writes `balance` or `apiKey` (true today).

**Size.** M (two product files, five test files). Mechanical.

---

## 3. `useBitChat` as one transport table, bubble-ready rows, retry inside

**Module and callers.** `features/bitchat/hooks/useBitChat.ts:143-577`; one caller,
`features/bitchat/screens/GeohashChatScreen.tsx:93-97`, which two routes render
(`app/(user-flow)/geohashChat.tsx:30`, `app/(user-flow)/bitchatDM.tsx:51`).

**Obligation today.**
- Four effects (`useBitChat.ts:176-241`, `:265-295`, `:306-334`, `:345-378`) repeat one template: add listeners,
  connect, `setIsConnected(true)`, remove listeners and `setIsConnected(false)`. Two of the four carry a `cancelled`
  check; the BLE ones do not, so a start resolving after cleanup sets the dot back on (D6).
- The screen rebuilds delivery status with a cast: `(m as { deliveryStatus?: ... }).deliveryStatus` then
  `richStatus ?? (m.isPending ? 'sending' : 'sent')` (`GeohashChatScreen.tsx:150-154`), because the hook returns
  `ChatMessage[]` though its BLE DM rows are `BleDmMessage`.
- The screen owns the retry: a module-level `retriedBleDmIds` set plus a state copy (`:67-73`, `:141`), a lookup of
  the original text in `messages` (`:324`), and the double-tap guard (`:325-337`).
- `DMTarget.nickname` is accepted and never read (`useBitChat.ts:126-130`; only `options.dm?.peerID` is read at
  :154), yet the screen builds it (`GeohashChatScreen.tsx:96`).
- `onBack` is passed as `() => router.back()` by both routes (`geohashChat.tsx:34`, `bitchatDM.tsx:56`), which is the
  screen's own default (`GeohashChatScreen.tsx:140`).

**Proposed shape.** `useBitChat({ transport, geohash?, peerID? })` returns
`{ messages: ChatBubbleMessage-shaped rows with deliveryStatus, isConnected, send(text), retry(id) }`. Inside, one
effect drives a table `{ ble, 'ble-dm', nostr, 'nostr-dm' } → { listen(onMessage), connect(isCancelled), send }`
with one cancelled flag for all four. The retried-id set moves into the hook (module scope, as today). The screen
drops the cast, the status fallback, the retry closure and `onBack`. `useBitChat` stays the one owner; the BLE DM rows
still come from `useBitchatDmMessagesStore`.

**Deletion test.** Removing the screen's mapping and retry loses nothing once the hook returns them; removing the
hook would put four transports' wiring into the screen.

**Deletes.** About 60 in the hook (three repeated effect bodies), ~35 in the screen; adds ~15 for the table. Net
~80 down.

**Risk.** None stored or sent: the same native calls, in the same order, per transport. Lost text on a failed
public or geohash send is F183 (the owner's design choice); this candidate must not change it.

**Pins.** `bitchatSend.test.tsx` (18 cases: every transport's send, native rejection, watchdog),
`bitchatDmRetry.test.tsx` (one retry per failed message), `bitchatPeerEvents.test.ts`,
`bitchatBridgeLifecycle.test.tsx`, `bitchatSovranPrefixSuppression.test.tsx`. Pin first: what the screen renders as
`deliveryStatus` for an own row on each transport (today only the store is pinned for BLE DM), and the D6 late-resolve
(BLE start resolving after unmount: expect the dot off).

**Size.** M (hook, screen, two routes). Behaviour-preserving except D6 if fixed on the way.

---

## 4. AI "the model a send goes to": one owner

**Module and callers.** `features/ai/lib/format.ts:693-700` (`resolveSelectedEntry`) and the store fields it is fed
from. Every site reads `selectedProvider`, `selectedTier`, a lineup and a balance and resolves them itself:
- `features/ai/components/ModelChip.tsx:67-92` (wallet sats from `useRoutstrFunds`, `lineup ?? lastKnownLineup`),
- `features/ai/screens/AiChatScreen.tsx:166-177` (the image button; **`routstrStore.balance` msats**, see D2),
- `features/ai/hooks/useAiSend.ts:274-293` (stream), `:580-584` (fallback adoption), `:1061-1070` (spend quote),
- `features/ai/lib/modelPickerRequest.tsx:209-227` via `hooks/useModelPicker.ts:21-31` (a different lineup rule, D5),
- `shared/stores/profile/routstrStore.ts:1335` (`setSelectedSlot`).
The lineup fallback `lineup ?? lastKnownLineup?.lineup ?? null` is written seven times (the six above plus
`routstrStore.ts:1835` for hydrate).

**Obligation today.** Each caller must remember which balance (wallet sats, not the legacy key balance), which lineup
rule and the `getProviderById`/`getTierById` normalisation. One already drifted: the image button resolves against a
balance nothing writes any more (D2). `useAiSend` also returns `balance` (`useAiSend.ts:1380-1381`), which its one
caller does not read (`AiChatScreen.tsx:179`).

**Proposed shape.** In `routstrStore`, one exported `selectLineup(state)` (today's `??` rule; the picker keeps its own
rule until the owner rules on D5). In `features/ai`, one `useSelectedEntry()` hook returning
`{ entry, lineup, served }` from the store and `useRoutstrFunds`, used by `ModelChip` and `AiChatScreen`; `useAiSend`
uses the non-hook `selectedChain(state, nodeBaseUrl)` built on the same selector. `useAiSend` stops returning
`balance`. `format.ts` stays the owner of the arithmetic.

**Deletion test.** Removing the per-site derivations loses nothing; removing the shared hook would bring the
three-input derivation back to each site.

**Deletes.** About 40 lines across five files; adds ~15. Net down.

**Risk.** Which model is paid. The send path's inputs must stay exactly as today (wallet sats, `availableChain`
ordering, the same lineup rule) so the cut is mechanical there; the only behaviour change is the image button
reading wallet sats (D2), which changes no request.

**Pins.** `aiE2eeCandidateChain.test.ts`, `aiSendAssembly.test.ts:174-198`, `aiStrandedSealedSelection.test.tsx`,
`modelPickerModelsLoading.test.tsx`, `modelPickerSealedReserve.test.tsx`, `aiSendRequestShape.test.ts`. Pin first:
the image button against a lineup whose first entry has vision and is unaffordable while a later one is affordable
without it.

**Size.** S–M (five files). Mechanical for the send; one deliberate fix for the button.

---

## 5. Signer: ending a client's session, one owner

**Module and callers.** `features/nostrSigner/data/nip46RequestsStore.ts`: `revokeSessionGrant` (:156-160, :268),
`revokeSessionAllows` (:168, :297), `setAppThrottled` (:170). Three places end an app's session, each with its own
subset:
- Disconnect, `screens/SignerAppDetailScreen.tsx:586-588`: grants, allows, then `disconnectApp`.
- Block, `lib/verdictResolver.ts:150-153`: `blockApp`, grants, allows (then flushes the app's queue).
- Re-pair replacing a previous client, `lib/nip46Engine.ts:1004-1009`: grants and the throttle flag, **not allows**.

**Obligation today.** Whoever removes a connection must remember to revoke both kinds of runtime session state and
the cooldown; the replace path forgot one (D4).

**Proposed shape.** One store action `endClientSession(clientPubkey)` that revokes session grants and session allows
and clears the throttle flag; the three paths call it. The connections store keeps `disconnectApp`/`blockApp`. The
requests store is the one owner of "this session's state for an app".

**Deletion test.** The pairs at each site disappear into one call; without the action the obligation is back at three
sites.

**Deletes.** ~10 lines; the value is the obligation, and it closes D4.

**Risk.** Signing permissions (security). Clearing more on replace only removes auto-approval for a key that no
longer has a connection; it can make a prompt appear, never skip one.

**Pins.** `nip46RequestsStore.test.ts`, `nip46Engine.test.ts` (replace/adopt cases), `nip46ApprovalController.test.ts`.
Pin first: session allow for A, re-pair B replacing A, then a fresh pairing of A's key asks again (fails today).

**Size.** S (store, engine, resolver, one screen).

---

## 6. Map: camera and markers as one hook

**Module and callers.** `features/map/hooks/useMapCamera.ts` (113 lines) and `hooks/useMapMarkers.ts` (238 lines);
one caller each, `features/map/screens/MapScreen.tsx:73-118`.

**Obligation today.**
- The two hooks form a cycle the screen closes by hand: a forwarding `onCameraSettleRef`, a kept-identity
  `useCallback`, and a `useInsertionEffect` that points the ref at `updateMarkersForCamera` (`MapScreen.tsx:69-118`).
- Every programmatic move is written twice, `setCamera(x)` then `updateMarkersForCamera(x)`: location on mount
  (:150-151), My Location (:164-165), zoom in (:172-175), zoom out (:179-182), cluster tap (:201-206).
- The markers hook re-exports store members it does not own: `storeLoading`, `error`, `setError`, `fetchPlaces`
  (`useMapMarkers.ts:49-57,146-154`), and its internals `resolveMarker` and `clusterManagerRef`, which the screen uses
  to compute the cluster's expansion zoom (:188-200). The screen then derives `loading = storeLoading ||
  !isClusteringReady` (:120). The "Retry" button calls the re-exported `setError(null)`, which retries nothing (D1).

**Proposed shape.** One `useMerchantMap({ category, aspectRatio, isMapReady })` returning `{ mapRef, markers,
visibleCount, totalCount, loading, error, retry, moveTo(camera), zoomBy(delta), pressMarker(id) → placeId | null,
handleCameraChange }`. `moveTo` sets the camera and updates markers; `pressMarker` expands a cluster itself and returns
a place id for the screen to navigate to; `retry` clears the error and calls `fetchPlaces(true)`. The cluster manager
and the BTC Map store stay inside.

**Deletion test.** The forwarder, the insertion effect and the five pairs vanish; nothing reappears in the screen.

**Deletes.** About 50 lines from the screen and the two interfaces; the hook bodies merge without growing.

**Risk.** None stored or sent. Camera timing (250 ms debounce, `InteractionManager`) must stay as it is.

**Pins.** `useMapMarkers.test.ts` (empty filter, cached reopen, hidden map, blur cancel),
`mapCameraMerchantDetail.test.tsx` (platform config, settle and debounce). Pin first: a cluster tap moves the camera
and recomputes markers once; Retry after a failed load (D1, fails today).

**Size.** M (two hooks into one, the screen, two test files). Behaviour-preserving except D1.

---

## 7. White Noise context: per-account storage, network owns relay fallback

**Module and callers.** `features/whitenoise/WhitenoiseContext.ts:7-12` (`client`, `inviteReader`, `relays`,
`accountIndex`); six consumers (`hooks/useWhitenoiseDM.ts:220`, `useWhitenoiseRequests.ts:37`,
`useWhitenoiseDmContacts.ts:19`, `useWhitenoiseInbox.ts:35`, `useWhitenoiseSetup.ts:105`,
`components/WhitenoiseSetupBanner.tsx:64`).

**Obligation today.**
- `relays` is the module constant `relays` from `shared/ndk.ts:1` in all three branches of the provider
  (`WhitenoiseProvider.tsx:41,61,79`), and the network it builds already falls back to that same constant on an empty
  list (`client/network.ts` `relaySet`, `publish`, `getUserInboxRelays`). Callers still carry it and re-check it:
  `resolveInboxRelays(network, pubkey, relays)` (`useWhitenoiseInbox.ts:66`, `useWhitenoiseDM.ts:552`),
  `relays.length > 0 ? [...relays] : []` (`useWhitenoiseDM.ts:551`), `group.relays ... : [...relays]`
  (`useWhitenoiseDM.ts:279`), `relays.length === 0 → 'No relays configured'` (`useWhitenoiseSetup.ts:72-75`, never
  true), and it threads through `SendDmCtx` (:437) and `useLatestRef` (:329).
- `accountIndex` is handed out so callers can build storage: `new WhitenoiseDmIndex(accountIndex)` at
  `useWhitenoiseDM.ts:400,576`, `useWhitenoiseRequests.ts:135`, `useWhitenoiseDmContacts.ts:21`;
  `new AsyncStorageKVBackend(whitenoisePrefix(accountIndex, InboxCursor))` at `useWhitenoiseInbox.ts:41-47`.
  The prefix rule is repeated in `storage/index.ts`, `inviteStore.ts`, `groupHistory.ts`, `dmIndex.ts`.

**Proposed shape.** The provider builds one `WhitenoiseAccountStorage` per account (`{ dmIndex, inboxCursor, invites,
groupState, keyPackages, historyFor(groupId) }`, keys exactly as today) and the context carries `storage` instead of
`accountIndex` and `relays`. The network exposes `inboxRelaysOf(pubkey)` (never throws, falls back itself) and
`fallbackRelays` for the two places that must write an explicit list into an event (`createGroup` relays,
`keyPackages.create`). `OpenedFor` in `useWhitenoiseDM` compares `storage` identity instead of `accountIndex`.

**Deletion test.** The fallback checks and constructor calls vanish from the hooks; the per-account rule lives in one
factory.

**Deletes.** About 40 lines (the dead relay check, three fallback re-derivations, four index constructions, the
inbox's backend memo, `resolveInboxRelays`'s parameter); adds ~15 for the factory. Net down.

**Risk.** Wire: the relay list written into a new group and into key packages must stay the same constant. Saved
data: every key stays `whitenoise:<accountIndex>:<namespace>:<key>`; audit 33 F-008 (a fresh index per account) holds
because the storage object is per account. No stored shape changes.

**Pins.** `whitenoiseStorage.test.ts` (real backends, two accounts), `whitenoiseDmSend.test.tsx`,
`whitenoiseInboxRequests.test.tsx`, `whitenoiseSetupBanner.test.tsx`, `inProcessProfileSwitch.test.ts`; their context
wrappers change shape. Pin first: the relay list passed to `createGroup` and to `keyPackages.create`.

**Size.** M (provider, context, five hooks, storage index, tests). Mechanical.

---

## 8. Signer hot flag as leases (F225)

**Module and callers.** `features/nostrSigner/data/nip46RequestsStore.ts:97-102,171,318-320`
(`serviceHotRequested`, `setServiceHotRequested`); reader `hooks/useNostrSignerService.ts:86-90`; writers
`screens/ShareSignerScreen.tsx:119,122`, `components/SignerConnectSheetContent.tsx:214,601`,
`hooks/useConnectSheetOpener.ts:42,48`, `lib/openPairingFromUri.ts:86`.

**Obligation today.** One boolean with four writers and a written rule, "the surface that set it owns resetting it"
(`nip46RequestsStore.ts:99-100`), plus "hot first, clear second" in the opener (`useConnectSheetOpener.ts:7-11,40`).
Closing the connect sheet over Share Signer clears the flag the share screen still needs (pass 2 D10, filed in F225).

**Proposed shape.** `acquireSignerHot(): release` (a lease set, as `acquirePublicBLEMesh` does in
`BitChatModule.ts:197-206`), with `wantsHot` reading "any lease held". Share Signer and the connect sheet hold leases
for their lifetimes; the opener and `openPairingFromUri` hold a handoff lease the sheet's mount takes over (or that is
released if the sheet does not open). `setServiceHotRequested` and the reset rule go.

**Deletion test.** The paired true/false writes vanish; two holders stop cancelling each other.

**Deletes.** ~15 lines and the rule; adds ~15 for the lease set. Lines flat; the obligation and the defect go.

**Risk.** The signer going cold under a link being shown (today's bug) or staying hot with no holder (a lease leak).
Not stored.

**Pins.** `nip46PairingEntry.test.ts` (flag set and cleared), `nip46SignerService.test.ts` (start conditions),
`signerConnectRoute.test.tsx`. Pin first: two holders, release one, engine still started; the handoff lease released
when the sheet fails to open.

**Size.** S–M (store, service, four writers).

---

## 9. Signer surface only tests use

**Module and callers.**
- `Nip46Engine.onUserVerdictNeeded` and its machinery (`lib/nip46Engine.ts:188,241,268,325-335,1099-1104,1118`):
  production callers 0; `nip46Engine.test.ts:977` and a mock in `nip46SignerService.test.ts:36`. Prompts reach the UI
  through the request store's queue (`useSignerApprovalController`), not this callback.
- `useNip46ConnectionsStore.unblockApp` and `updateMetadataAfterApproval` (`data/nip46ConnectionsStore.ts:299,306,
  638-641,669-677`): only `nip46ConnectionsStore.test.ts:316,350-378`.

**Obligation today.** None; a reader of the engine's interface learns a notification path the app does not use, and
of the store a re-pair metadata refresh that nothing performs ("only call after user approval (blocks
rename-phishing)" guards a call that never happens).

**Proposed shape.** Delete them and their tests. The engine interface loses one member and one internal set.

**Deletion test.** Nothing is lost.

**Deletes.** ~35 lines in the engine, ~20 in the store; ~60 test lines. Net down.

**Risk.** None; the stored connection shape is untouched.

**Pins.** The ask-path test at `nip46Engine.test.ts:972-993` keeps its queue assertions without the callback.

**Size.** S. Mechanical.

---

## 10. BLE start request: one builder

**Module and callers.** `modules/bitchat-module/src/BitChatModule.ts:140-189` (`StartBLERequest`, `startBLE`).
Three app callers build the request from the same three hooks: `features/bitchat/hooks/useBitChat.ts:148-150,185,273`
and `features/nearPay/hooks/useNearbyDiscovery.ts:51-53,257-262`. The hooks are
`hooks/useBitchatNickname.ts`, `lib/profileScope.ts` (which writes the active-profile selector twice, `:8-14` and
`:16-21`, beside `selectActiveProfile` in the profile store) and `hooks/useBitchatBLEIdentityMaterial.ts`.

**Obligation today.** Each caller gathers three values, guards that two are present, and decides the nickname
fallback: discovery passes `nickname || 'sovran'` (`useNearbyDiscovery.ts:258`), `useBitChat` passes the raw
nickname, and the lease restarts replay whichever start came last (`BitChatModule.ts:201,204`), as pass 2 noted.

**Proposed shape.** `useBitchatStartRequest(): StartBLERequest | null` in `features/bitchat`, built from the active
profile and keys, with the fallback in one place; `getBitchatProfileScope` becomes `selectActiveProfile(...)?.pubkey`.
Callers pass the request (plus `creq` for discovery). The bridge's Requested-versus-Running question stays with F207.

**Deletion test.** The three-hook gathering vanishes from each caller.

**Deletes.** ~25 lines; the two hooks become one.

**Risk.** BLE announce nickname (sent over the air). The nickname is `''` only without `keys.pubkey`
(`useBitchatNickname.ts:19`), and then the identity material is null and no start happens, so one fallback changes
nothing sent. Profile scope keys native storage: the value is the same pubkey.

**Pins.** `nearbyDiscoveryLifecycle.test.tsx`, `bitchatSend.test.tsx`, `bitchatPeerEvents.test.ts`,
`bitchatProfileScope.test.ts`, `bitchatBridgeLifecycle.test.tsx`. Pin first: the request each caller passes today.

**Size.** S (three hooks, two callers).

---

## 11. Blocked-conversation guard for the three DM screens

**Module and callers.** `features/feed/stores/ignoreStore.ts` read the same way by three screens:
`features/bitchat/screens/GeohashChatScreen.tsx:133-135,302-308,309-315`,
`features/whitenoise/screens/WhitenoiseDMScreen.tsx:31,80,90-99`, `features/user/screens/UserMessagesScreen.tsx:97,
336,549-553` (the last is the feed survey's area).

**Obligation today.** Each screen selects `blocked`, empties the list, disables the composer, renders the same banner
text ("This person is blocked. Open “Block or report” to unblock them."), and re-checks
`useFeedIgnoreStore.getState().ignoredPubkeys.includes(...)` inside `onSend`.

**Proposed shape.** `useBlockedConversation(pubkey | undefined): { blocked, banner, guardSend(send) }` in
`features/feed` (beside the store; `DmChatHeader` already imports `features/feed` moderation), or a `blockedPubkey`
prop on `ChatScreen` if the owner prefers the shared component to own it. One owner of the copy and the send check.

**Deletes.** ~25 lines across three screens; adds ~15. Net down.

**Risk.** None.

**Pins.** `whitenoiseDmScreenComposer.test.tsx` (records ChatScreen props). Pin first: a blocked peer's send is not
dispatched on each screen.

**Size.** S (three screens, one hook).

---

## 12. `useWhitenoiseDM` returns its phase

**Module and callers.** `features/whitenoise/hooks/useWhitenoiseDM.ts:36-44,345-353`; one caller,
`screens/WhitenoiseDMScreen.tsx:37-38,92-93,98-119`.

**Obligation today.** Pass 2 gave the hook one `Conversation` union, then projected it to five values
(`isClientReady`, `isLoading`, `isCreatingGroup`, `error`, `hasGroup`); the screen rebuilds the phase from them: the
composer gate `!isClientReady || isLoading || isCreatingGroup` (:92) and a four-way empty-text ternary (:113-119).

**Proposed shape.** Return `{ status: 'no-client' | 'loading' | 'empty' | 'creating-group' | 'ready' | 'failed',
error, messages, send }`, decoded once from the union by the hook. The screen switches on `status`.

**Deletes.** ~20 lines (the projection and the screen's ternaries).

**Risk.** None.

**Pins.** `whitenoiseDmSend.test.tsx` asserts on the five flags (rewrite to `status`),
`whitenoiseDmScreenComposer.test.tsx`.

**Size.** S. Mechanical.

---

## 13. White Noise provider teardown: one `close(mode)`

**Module and callers.** `features/whitenoise/WhitenoiseProvider.tsx:16-21` (handle with `value`, `disposeSigner`,
`shutdown`, `release`), `:95-116` (`disposeWhitenoiseHandle`), `:138-180` (two effects keyed on `handle`);
`client/index.ts:19-24` (client handle with `disposeSigner` beside a `shutdown` that also disposes the signer, :58).

**Obligation today.** Both effects branch on `useSettingsStore.getState().inProcessProfileSwitch` (:153, :174) and
must agree: the first runs the async drain and release for an in-process switch, the second zeroes the signer
synchronously otherwise. The handle exposes the signer's disposer twice (directly and inside `shutdown`).

**Proposed shape.** The handle exposes `value` and `close(mode: 'switch' | 'unmount')`; one effect registers the
account holder and switch service and calls `close` with the mode on cleanup. `disposeSigner` leaves both handles.

**Deletes.** ~40 lines (`disposeWhitenoiseHandle`, the second effect, the duplicate field).

**Risk.** Keys: the nsec copy must still be zeroed on every exit, and an in-process switch must still drain invite
decrypts before zeroing. Not stored.

**Pins.** `inProcessProfileSwitch.test.ts` (fast switch, zeroed signer, loaded-MLS refusal),
`whitenoiseSignerDispose.test.ts`. Pin first: a plain unmount (no in-process switch) zeroes the signer and removes
listeners, and a throwing `removeAllListeners` still lets the unmount finish.

**Size.** M (provider, client, two tests).

---

## 14. White Noise setup: one owner per account

**Module and callers.** `features/whitenoise/hooks/useWhitenoiseSetup.ts:104-151`; three callers, each its own
instance: `features/user/components/SendMessageMenu.tsx:43` (reads only `isReady`),
`components/WhitenoiseSetupBanner.tsx:63`, `screens/WhitenoiseSetupScreen.tsx:14-15`.

**Obligation today.** Each instance reads the key-package count, keeps it by `+1/-1` event deltas, and has its own
single-flight; two surfaces can bootstrap at once and each computes `need` from the same starting count (D7). The
count is the readiness F225 questions.

**Proposed shape.** The provider owns one setup state per account (count, phase, error, the one bootstrap); the hook
reads it. Lines about flat; the duplicated reads and the parallel bootstrap go. Decide F225's readiness rule first,
or this moves the same wrong count into one place.

**Risk.** Key packages are published to relays (wire); publishing fewer duplicates is the only change.

**Pins.** `whitenoiseSetupBanner.test.tsx`, `sendMessageRecommendationMenu.test.tsx` (mocks the hook). Pin first: two
concurrent bootstraps publish `TARGET - count` packages in total.

**Size.** S–M.

---

## 15. `BluetoothNotice` takes the state it is always given

**Module and callers.** `features/bitchat/components/BluetoothNotice.tsx:80-82,114-116` (`BluetoothNotice`,
`BluetoothInlineNotice`, each `bluetoothProp ?? useBluetoothState()`); callers
`screens/NetworkSheet.tsx:175`, `screens/GeohashChatScreen.tsx:261`, `features/nearPay/screens/NearPayScreen.tsx:2182`,
all passing `bluetooth`.

**Obligation today.** None for callers; each notice still runs its own `useBluetoothState()` (a native state listener
and an AppState listener) whose result is thrown away.

**Proposed shape.** Make `bluetooth` required; delete the fallback call.

**Deletes.** ~6 lines and two subscriptions per mounted notice. **Risk.** None. **Pins.** None needed. **Size.** S.

---

## Defects

`docs/follow-ups/` was grepped first. Already filed and not repeated: F183 (silent failed public or geohash send),
F184 (inbox start not retried), F206 (White Noise leftovers on failure), F207 (bridge filter timing), F225 (setup
readiness count; signer hot flag), F232 (AI partial text), F234 (White Noise send guard shared across peers), F239.

| # | Defect | Where | Path that reaches it | Failing test idea | Stored or sent? |
| - | ------ | ----- | -------------------- | ----------------- | --------------- |
| D1 | The map's "Retry" only dismisses the error; nothing fetches the places again, so a failed first load shows an empty map until the screen is reopened | `features/map/screens/MapScreen.tsx:229` (`setError(null)`); the only fetch is the mount effect `:132-138` | open the map offline with no cached places; tap Retry | `fetchPlaces` rejects once; press Retry; expect a second `fetchPlaces` call | No |
| D2 | The AI composer's image button resolves the selected model against `routstrStore.balance`, which nothing writes since the top-up deletion (null on a new install, a stale key balance on an old one), while the chip and the send use wallet sats; the button can offer images for a model other than the one the chip names, or refuse them for one that takes them | `features/ai/screens/AiChatScreen.tsx:168-177` vs `components/ModelChip.tsx:85-92`, `hooks/useAiSend.ts:276-293` | a wallet that cannot afford the slot's first model but can afford a later one with different `visionInput` | lineup `[vision unaffordable, text affordable]`: expect `canAttachImages` false (true today) | No (the send strips images it cannot send, `useAiSend.ts:352-365`) |
| D3 | A failed White Noise accept or decline is invisible: the hook sets `error`, nothing renders it, the spinner just stops | `features/whitenoise/hooks/useWhitenoiseRequests.ts:151,174`; `features/contacts/screens/ContactsScreen.tsx:182-187` reads only `requests`, `busyId`, `accept`, `decline` | `joinGroupFromWelcome` rejects (no key package left, relay failure) | render the requests row with a rejecting join; expect visible failure | No (F206 covers what the failed accept leaves behind, not this) |
| D4 | Replacing a signer connection revokes the old client's session decrypt grants and cooldown but not its session allows; if that client key pairs again in the same engine session, its session-allowed kinds (wallet sign kinds included) are approved without a prompt | `features/nostrSigner/lib/nip46Engine.ts:1008`; compare `lib/verdictResolver.ts:152-153`, `screens/SignerAppDetailScreen.tsx:586-587` | allow-for-session on A, re-pair as B replacing A, pair A's key again before the engine stops | as above: expect `ask` (today `session_allow`) | No; runtime only. Traced, edge |
| D5 | The model picker and the chip or send disagree on which lineup is current when the live lineup is present but empty: the picker falls back to the last-known lineup (it tests for entries), the chip and the send keep the empty one (`??`), so the picker lists models the chip calls "Not on this node" and a send refuses with `routstr.no_usable_models` | `features/ai/lib/modelPickerRequest.tsx:220-222` vs `components/ModelChip.tsx:70`, `hooks/useAiSend.ts:286,582,1068`, `screens/AiChatScreen.tsx:175`, `routstrStore.ts:1335` | a catalog fetch whose derivation qualifies nothing (`lineup.ts:512,686` start from `emptyLineup()`); the picker's own comment says this happened | live lineup `emptyLineup()`, last-known with rows: expect picker and chip to name the same model | No. Which rule is right (fall back to last-known for sending, or not) is the owner's decision |
| D6 | A BLE chat's connection dot can come back on after leaving: the BLE effects set `isConnected(true)` when `startBLE` resolves with no cancelled check | `features/bitchat/hooks/useBitChat.ts:185-190,273-274` | leave or switch the chat before the start resolves (traced in pass 2, not filed) | unmount before `startBLE` resolves; expect `isConnected` false | No. Display only |
| D7 | The setup banner and the setup screen each run their own bootstrap; two concurrent runs each publish `TARGET - count` key packages | `features/whitenoise/hooks/useWhitenoiseSetup.ts:136-142` (per-instance `useSingleFlight`) | tap the banner's Set up, open the setup screen and tap again while the first runs | two hook instances bootstrap at once: expect 2 packages in total | Publishes extra key packages. Traced, edge |

Lower, not promoted: stale doc claims on the dead bridge wrappers (candidate 1); `useAiSend` returns a `balance` no
caller reads (candidate 4).

## Not read

- Native BitChat bridges (Swift, Kotlin) and vendored BitChat: whether native ever needs JS to call `leaveGeohash` or
  `resetBLEPrivateChat`, and whether `sendBLEPrivateMessage` accepts bodies over 254 bytes on both platforms (the
  unchunked nearby payments already assume it).
- `features/bitchat/screens/NetworkSheet.tsx`, `hooks/useLocationTiers.ts`, `components/BluetoothNotice.tsx` beyond
  the prop lines.
- Signer: `SignerConnectSheetContent.tsx` beyond the hot-flag and release lines, `SignerApprovalSheetContent.tsx`,
  `SignerAppDetailScreen.tsx` and `SignerAppPermissionsScreen.tsx` beyond the grant and revoke lines (they share
  `PermissionKeyRows`/`permissionRowModel`; possible duplication not measured), the gesture demo, activity screens,
  `nip46Engine.ts` request pipeline (:384-880), `nip46Transport.ts`, `requestSummary.ts`, `appDataOps.ts`,
  `bunkerSecrets.ts`, `pairingIntentStorage.ts`.
- AI: `useAiSend.ts` :480-1060 (candidate walk and stream loop), `AiMessageBubble.tsx` beyond its props,
  `ProviderListScreen`, `ProviderInfoScreen`, `useProviderRows`, `providerListLog.ts`, `reserve.ts`, `branching.ts`,
  most of `format.ts`; `routstrStore.ts` beyond the lines cited (the stores survey's).
- Routstr: `sdk/client.ts` beyond `settleRoutstrClient`/`shutdownRoutstrClient`, `lineup.ts`, `discovery.ts`,
  `providers.ts`, `reclaim.ts` beyond its key use. `useRoutstrFunds` takes accepted mints from
  `knownProviders[userNodeBaseUrl]` while `api.ts:124-131` takes them from `acceptedMintsForProvider(origin)`; whether
  those two sources can disagree was not traced (money, so out of this pass's scope either way).
- Map: `MerchantDetailScreen.tsx` and `StatsCard.tsx`.
- No test file was run; no device, simulator, relay, mint or provider was used.
