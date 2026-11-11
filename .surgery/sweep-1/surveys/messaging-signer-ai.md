# Sweep 1 survey: messaging, signer, AI and map

Area: `app/features/bitchat`, `app/features/whitenoise`, `app/features/nostrSigner`, `app/features/ai`,
`app/shared/lib/routstr`, `app/features/map`. Checkout `sovran-surgery`, branch `surgery/sweep-1`. Paths are relative
to `app/` unless they say otherwise.

How it was done: read the LEDGER, the follow-up index and every follow-up that names this area (F02, F04, F24, F28,
F42, F48 to F53, F77, F88, F99, F102, F119, F127, F131 to F133, F153, F183, F184, F195, F196, F198, F206, F207, F225,
F232, F233, F239, F241, F242), and the pass 3 survey for this area, so nothing below repeats them. Read the pass 3
commits that touched the area. Ran `bun run knip` (clean), a script that greps every export in the area against
non-test sources in `app`, `wallet` and `nostr` (only test seams turned up), and `bunx eslint` on the six area files
that carry suppressions (no stale suppression; the counts still match). No test file was run, no test was written,
nothing was run on a device. "Traced" means followed through the code.

Counts: Broken 8 (5 fix), Inconsistent 7 (5 fix), Inefficient 3 (0 fix), No longer needed 5 (2 fix), Regrown 2 (1 fix).

## 1. Broken

**B1. White Noise invitations sent while the app was closed can be missed for good.** list

- Where: `features/whitenoise/hooks/useWhitenoiseInbox.ts:18` (`CURSOR_SLACK_SECONDS = 60`), `:84-85` (`since =
  cursor - 60`), `:138-146` (cursor = highest `created_at` of any fresh gift wrap).
- Path: a gift wrap's `created_at` is deliberately backdated. Marmot wraps welcomes through applesauce's
  `randomNow()`, up to an hour back (`node_modules/applesauce-common/dist/operations/gift-wrap.js:18-19`). Other
  NIP-59 clients backdate up to two days, and so does the app's own NIP-17 sender (`shared/lib/nostr/nip17.ts:42`).
  The subscription is every kind 1059 `#p` self, so a NIP-17 DM moves the cursor too. Example: a wrap arrives and the
  cursor is set to its `created_at` T. The app is closed. A welcome sent ten minutes later carries a `created_at` 40
  minutes before T. The next cold start asks for `since: T-60` and never fetches it. Live delivery is the only way
  it arrives. The rest of the app already knows this: `features/payments/data/dmPagination.ts:4` and
  `useDmEcashAutoRedeem.ts:63` allow two days.
- Test idea: save cursor T. A relay stub holds a welcome wrap with `created_at` T-600. Start the inbox and expect the
  REQ's `since` to be T-600 or earlier. Today it is T-60.
- Repair: a two-day slack. The InviteReader's `seen` store already drops repeats. Nothing saved changes shape, but
  the REQ filter sent to relays changes, so the owner picks the window.

**B2. The merchant map jumps back to the person's location whenever the window size changes.** fix

- Where: `features/map/screens/MapScreen.tsx:97-113`. The location effect depends on `[moveTo]`. `moveTo`
  (`hooks/useMerchantMap.ts:254-260`) depends on `updateMarkersForCamera`, which depends on `aspectRatio`, which
  comes from `useWindowDimensions` (`MapScreen.tsx:60-61`).
- Path: open the map, pan to another city, then rotate the phone or resize a split screen. The effect runs again:
  it asks for location permission, reads the GPS and moves the camera to the person's own area at zoom 12. Pass 3
  carried this over: the deps were `[setCamera, updateMarkersForCamera]` before.
- Test idea: render `MapScreen` with `expo-location` mocked, then change the window dimensions. Expect
  `getCurrentPositionAsync` to be called once (today twice) and the camera to stay where it was.
- Commit: "Centre the map on the person's location once, not on every resize". Run the mount effect once and read
  `moveTo` through `useLatestRef`. Nothing saved or sent changes.

**B3. The White Noise setup screen can wait for ever with its button disabled.** fix

- Where: `features/whitenoise/hooks/useWhitenoiseSetup.ts:102` (`isLoading` starts true) and `:106-107` (the effect
  returns before clearing it when there is no client). The screen disables its button on `isLoading`
  (`screens/WhitenoiseSetupScreen.tsx:37`).
- Path: the client failed to build (`whitenoise.client.create_failed`, `WhitenoiseProvider.tsx:99-104`) or there is
  no private key. Send Message routes to setup whenever White Noise is not ready (`features/user/components/
  SendMessageMenu.tsx:103`). The screen then shows "Set up White Noise" disabled, with no
  error and nothing that changes it.
- Test idea: render the setup screen with a context whose `client` is null. Expect the button enabled, or an error
  shown.
- Commit: "Stop the White Noise setup screen waiting on a client that never came". When `!client`, set
  `isLoading(false)`. Then Set up reports the existing "White Noise client not ready". Nothing saved or sent changes.

**B4. The AI model picker can ignore a tap on a model that appeared after it opened.** fix (traced)

- Where: `features/ai/hooks/useModelPicker.ts:27-31` builds `state` at render time. `:34-36` updates the open sheet
  with later requests. The result handler `:42-50` resolves the picked id against `state.lineup` as it was when the
  sheet opened.
- Path: open the picker before the catalog lands. `providersForLineup(null)` gives the static `AI_PROVIDERS`
  (`lib/format.ts:125-127`). The lineup then arrives with a vendor that was not in the open-time list, for example
  the sealed vendor, which sorts first. Tapping its row finds no `slot`, and the handler returns with nothing
  selected. A node repoint while the sheet is open does the same.
- Test idea: open with lineup A. Set the store to lineup B, which adds provider P. Resolve the picker with P's option
  id. Expect `setSelectedSlot` to be called with P.
- Commit: resolve the slot against `modelPickerState(useRoutstrStore.getState(), ...)` when the result arrives. The
  selection is session-only (`routstrStore.ts:480-491`). Nothing saved or sent changes.

**B5. Opening a Bluetooth DM with a peer whose name is over 64 characters bounces straight back.** fix

- Where: the route caps `nickname` at 64 (`app/(user-flow)/bitchatDM.tsx:27`). On an invalid param
  `useRouteParams` calls `router.back()` (`shared/lib/nav/useRouteParams.ts`). The callers pass names with no limit:
  `features/bitchat/screens/NetworkSheet.tsx:40-56` (`resolveIdentityName` over the peer's BLE nickname, which the
  native reader accepts up to 512 characters, `modules/bitchat-module/src/nativeEvents.ts:21,95`), and
  `features/user/components/SendMessageMenu.tsx:126-131` (`bitchatPeer.nickname`, matched to the contact's display
  name).
- Path: a nearby peer announces a 65-character nickname. Tap them in Network. The DM screen opens and closes again.
- Test idea: render the `bitchatDM` route with a 65-character `nickname`. Expect the screen to render; today it
  navigates back.
- Commit: clip the display name to 64 at the two callers, or `.transform` the param to a slice. It only changes a
  header label, and nothing saved or sent changes. Not checked: what limit upstream bitchat puts on nicknames.

**B6. A White Noise conversation started from this phone is missing from Contacts until the screen remounts.** list

- Where: `features/whitenoise/hooks/useWhitenoiseDmContacts.ts:34-42` re-reads the DM index only on the
  InviteReader's `inviteRead`. The first send writes the index in `useWhitenoiseDM.ts:575`, which fires no event.
- Path: Contacts → person → White Noise → first message → back. Contacts is still mounted under the stack, and
  Recent does not list the person. The hook returns a `refresh` that its one caller does not read
  (`features/contacts/screens/ContactsScreen.tsx:194`).
- Test idea: mount the hook, run `createDmGroup`'s index write, and expect `entries` to include the peer.
- Decision for the owner: re-read on focus, or have the DM index announce writes. No saved shape changes either way.

**B7. A failed listener removal on White Noise unmount skips zeroing the private key copy.** fix

- Where: `features/whitenoise/WhitenoiseProvider.tsx:87-96`. `client.removeAllListeners()`,
  `reader.value.removeAllListeners()` and `disposeSigner()` share one `try`, so a throw in either removal skips the
  zeroing. Pass 3's comment says this was kept on purpose (`:25-27`). There is no known trigger.
- Test idea: make `removeAllListeners` throw on a plain unmount, then expect a sign call to throw
  `whitenoise.signer: disposed`.
- Commit: "Zero the White Noise key copy on unmount even when a listener removal throws". Move `disposeSigner()`
  into `finally`. Nothing saved or sent changes.

**B8. With location refused, the Groups tab says "Getting your location..." for ever and loses the Bluetooth row.**
list

- Where: `features/bitchat/hooks/useLocationTiers.ts:48-53` returns before the Bluetooth tier (`:63-70`) is built,
  although that tier needs no location. `ContactsScreen.tsx:139` reads only `tiers` and drops `error`.
- Recorded only as a native scenario (`e2e/scenarios/contacts-groups-location-denied.json`, "known gap",
  `check:fault-tbd`). No follow-up exists, which AGENTS.md requires.
- Decision for the owner: what a denied location shows, and whether Bluetooth chat stays listed. Repairing it means
  flipping that scenario's asserts.

## 2. Inconsistent

**I1. "Copied" is still shown before, or regardless of, the clipboard write in four places.** fix

- Pass 3 fixed one site (`ed0415cc8`, `ReceiveRailListScreen`): the toast waits for the write, and a failure shows
  `staticPopup('copy-failed')`.
- In this area:
  - `features/nostrSigner/screens/SignerActivityDetailScreen.tsx:84-87` and `components/SummaryPreviewCards.tsx:
    390-393` toast before the write and ignore a failure.
  - `features/ai/components/AiMessageBubble.tsx:415-419` and `features/nostrSigner/screens/ShareSignerScreen.tsx:
    127-131` await the write but leave a rejection unhandled, so no failure toast shows.
- Commit: the same `.then(copied, copy-failed)` shape at all four. `ProviderInfoScreen.tsx:283` is silent by design
  and stays.

**I2. Regenerate and the error pill's Retry spend money without the spend sheet or the send gate.** list

- `features/ai/hooks/useAiSend.ts:1293-1360` (`prepareRetry`) never calls `evaluateSendGate` or `confirmSpend`, so
  there is no provider, accepted-mint or funds check. Its budget is whatever the primary model would reserve
  (`:377-390`).
- The screen states the opposite rule: "Continuing must never be the one way to spend money without being asked"
  (`screens/AiChatScreen.tsx:206-210`). `lib/spendConfirm.ts:7-16` calls the prompt unconditional.
- Decision for the owner: whether a regenerate asks. Not in F232, F239 or F49.

**I3. Ghost Bluetooth peers count as connected in the Network sheet and the chat badge, but not on payment
surfaces.** list

- `features/bitchat/screens/NetworkSheet.tsx:90-108` and `screens/GeohashChatScreen.tsx:84,150-153` read the raw
  directory. Nut Drop and Send filter it through `filterFreshBLEPeers` (`lib/blePeerSnapshots.ts:45-57`, used by
  `features/nearPay/hooks/useFreshNearbyPeers.ts`). That file's own comment says a ghost's cached `isConnected`
  never flips. So "3 connected" can include people who left.
- Decision for the owner: whether the sheet hides stale peers or marks them.

**I4. Two contradicting comment blocks stacked on one branch.** fix

- `features/ai/hooks/useAiSend.ts:300-311`: "Two different absences wearing one shape" is followed by "Three
  absences wearing one shape, not two", and both describe the same `id` choice. Delete the first. The change is a
  comment only.

**I5. `clearAllSignerData` says the engine keeps running.** fix

- `features/nostrSigner/lib/clearSignerData.ts:7-10`. Emptying the connections drops `hasActiveConnection`, and
  unless Share Signer or the connect sheet holds the hot flag, `useNostrSignerService.ts:73-98` stops the engine.
  When it does keep running, the engine's own `pendingContexts` and `awaitedPairings` (`lib/nip46Engine.ts:262-263`)
  are not cleared, contrary to "every sender is a stranger again".
- Commit: correct the comment. Clearing the engine maps is a separate, behaviour-changing commit.

**I6. The LEDGER's pass 0 pin table names a test that no longer exists.** fix

- `.surgery/LEDGER.md:80` lists "Routstr top-up | `routstrTopUp.test.ts`". The file went with the top-up deletion in
  pass 2 and is not in `app/__tests__/`. Drop the row or mark it removed.

**I7. The map logs half its failures through the root logger.** fix

- `features/map/hooks/useMerchantMap.ts:185,300` (`log.error('map.places.fetch_failed')`) and `screens/
  MapScreen.tsx:108,121` (`map.location.error`) use `log`. The same hook's cluster events use `mapLog` (`:119`).
  Change them to `mapLog`; only the logger scope changes.

## 3. Inefficient (unmeasured: listed, not proposed)

**E1. Each White Noise message rewrites the conversation's whole history.** list

- `features/whitenoise/storage/groupHistory.ts:36-44` reads, appends and rewrites the group's full rumor array, as
  base64 JSON, on every sent or received message. It has no cap.
- F48 covers zustand stores, not this key family.
- Cost grows linearly per message. It was not measured.

**E2. Every kind 24133 event from a stranger costs a keychain read.** list

- `features/nostrSigner/lib/nip46Engine.ts:610-617` calls `hasOutstandingSecret` before any crypto. That is a
  SecureStore read through the serialised queue (`lib/bunkerSecrets.ts:73-83,217-230`), so a burst of unsolicited
  events also queues ahead of a real `consumeSecret`.
- It only matters while the engine is hot. Not measured. A short in-memory "no secrets outstanding" cache would
  avoid it.

**E3. A programmatic camera move computes the pins twice.** list

- `moveTo` updates the pins at once (`features/map/hooks/useMerchantMap.ts:254-260`) but does not record the query
  in `useMapCamera`'s `lastMarkerQueryRef` (`hooks/useMapCamera.ts:83-107`). The native `onCameraMove` for the same
  move passes the skip test, and 250 ms later `getClusters` runs again. The `sameMarkers` check avoids a re-render,
  but not the query.
- This happens on locate, zoom, cluster tap and mount.

## 4. No longer needed

**N1. `RequestActions`'s `compact` prop.** fix

- Declared (`features/whitenoise/components/RequestActions.tsx:12-13`) and never read. The one caller
  (`ContactsScreen.tsx:376`) does not pass it. Delete it.

**N2. `MerchantDetailScreen`'s `styles.container`.** fix

- `features/map/screens/MerchantDetailScreen.tsx:400`: nothing reads it (grep `styles.container` in the file).
  Delete it.

**N3. The geohash Nostr DM transport (`'nostr-dm'`) has no way in from the app.** list

- No screen navigates to `bitchatDM` with `transport: 'nostr-dm'` (grep over `app`, `e2e`). The public geohash chat
  offers no tap-to-DM, so only a hand-made `sovran://...bitchatDM?transport=nostr-dm` link reaches it.
- It costs about 60 lines: `useBitChat.ts:294-314,548-561`, the `nostr-dm` branches in `GeohashChatScreen.tsx`, and
  the route refine.
- Decision for the owner: whether it is reachable from outside the repo by URL, and whether geohash DMs are planned.

**N4. `revokeSessionGrant`'s `grantKey` argument.** list

- Both callers pass `undefined` (`SignerAppDetailScreen.tsx:358`, `SignerAppPersonScreen.tsx:100`). Only
  `__tests__/nip46RequestsStore.test.ts:239` uses the per-method form. Removing it means changing a test of the store,
  so the owner decides.

**N5. `useWhitenoiseDmContacts().refresh`.** list

- Returned and never read (`ContactsScreen.tsx:194`). Keep it if B6 is repaired by calling it on focus; otherwise
  delete it.

## 5. Regrown

**R1. Pass 3's White Noise relay cut left the fallback derived again in two places.** fix

- `f412916fd`'s message says "the empty-list fallbacks re-derived in the DM send" are gone. Still left:
  - `useWhitenoiseDM.ts:280` does `group.relays && group.relays.length > 0 ? group.relays : [...appRelays]`, while
    `network.subscription` already falls back on an empty list (`client/network.ts:76-79`).
  - `resolveInboxRelays(network, pubkey, appRelays)` (`network.ts:211-222`; callers `useWhitenoiseInbox.ts:67` and
    `useWhitenoiseDM.ts:551-555`) passes the same constant the network was built with
    (`WhitenoiseProvider.tsx:63`). `getUserInboxRelays` already returns it when nothing is published.
- The constant is now imported in four files.
- Commit:
  - Subscribe with `group.relays ?? []`.
  - Have the network's `getUserInboxRelays` catch and fall back itself, and drop `resolveInboxRelays`'s parameter.
  - Keep the explicit list where it is written into an event: `createGroup`'s `relays` (`useWhitenoiseDM.ts:550,
    569`) and `keyPackages.create` (`useWhitenoiseSetup.ts:73,83`).
- The relay sets on the wire stay identical, because they are the same constant.

**R2. `useMapCamera` has one caller and needs a forwarder.** list

- After `77ca7ea4b`, `useMapCamera` is used only by `useMerchantMap`, which wraps its own updater in `useLatestRef`
  plus a `useCallback` (`useMerchantMap.ts:171-180`) to hand it in. The split survives for
  `__tests__/mapCameraMerchantDetail.test.tsx:137`. Merging the two would move that test.
- Decision for the owner: whether the seam is worth one forwarder. No behaviour change either way.

## Five most important

1. B1: White Noise invitations that arrive while the app is closed can be skipped for good (60 s slack against
   wraps backdated by up to two days).
2. I2: Regenerate and Retry on an AI answer spend sats with no spend sheet and no funds or mint check.
3. B2: the map re-centres on the person's location, asking for location again, on every rotation or resize.
4. B3: the White Noise setup screen can sit disabled for ever with no error when the client did not build.
5. I1: four copy actions still say "Copied" before or regardless of the clipboard write, which pass 3 fixed
   elsewhere.

## Not read

- Signer:
  - Not read: `SignerConnectSheetContent.tsx`, `SignerApprovalSheetContent.tsx`, `PermissionGestureDemo.tsx` and its
    timeline, `permissionCatalog.ts`, `PermissionKeyRows.tsx`, `permissionRowModel.ts`, `editorGrantKeys.ts`,
    `display.tsx`, `SignerAppPermissionsScreen.tsx`, `SignerAppPersonScreen.tsx` beyond the revoke line,
    `SignerActivityScreen.tsx`, `SignerHubScreen.tsx`, `SignerRequestsScreen.tsx`, `nip46Uri.ts`, `nip46Types.ts`,
    `requestSummary.ts`, `appDataOps.ts`, `permissionPolicy.ts`, `permissionBundles.ts`, `connectionMatch.ts`,
    `rateLimiter.ts`, `requestGrouping.ts`, `pairingIntentStorage.ts`, `pendingPairingUri.ts`,
    `openPairingFromUri.ts`, `switchProfileAndPair.ts`, `pairingPreset.ts`, `boundedDisplay.ts`, `json.ts`,
    `methodHandlers.ts`, `useResumePendingPairing.ts`, `useSignerApprovalController.ts`,
    `useReferencedEventPreview.ts`, `nip46ConnectionsStore.ts`, `nip46ActivityStore.ts`.
  - Read in part: `SignerAppDetailScreen.tsx` (lines 240-420 and the disconnect), `ShareSignerScreen.tsx` (60-140),
    `SummaryPreviewCards.tsx` (copy only), `SignerActivityDetailScreen.tsx` (copy only), `nip46Transport.ts` (header
    only).
- AI:
  - Not read: `format.ts` beyond `providersForLineup`, `AiHeaderTitle`, `AiTurnErrorPill`, `ProviderAvatar`,
    `ProviderMintRow`, `AiEmptyState`, `ProviderListScreen`, `useProviderRows`, `useModelCatalog`, `reserve.ts`,
    `branching.ts`, `turns.ts`, `attachments.ts`, `assembleApiMessages.ts`, `sendGate.ts`, `chatErrorActions.ts`,
    `modelAvailability.ts`, `providerPrivacy.ts`.
  - Read in part: `AiMessageBubble.tsx` (copy only), `ProviderInfoScreen.tsx` (copy only), `providerListLog.ts`
    (header), `modelPickerRequest.tsx` (state and request head), `ModelChip.tsx` (first 120 lines).
- Routstr:
  - Not read: `lineup.ts`, `discovery.ts`, `providers.ts`, `providerClaims.ts`, `providerHealth.ts`,
    `curatedModels.ts`, `tokenWire.ts`, `requestDeadline.ts`, `reclaim.ts`, `securePersistence.ts`, `sdk/driver.ts`,
    `sdk/paymentScope.ts`, `sdk/sdkLogger.ts`, `sdk/zlibShim.ts`.
  - Read in part: `api.ts` (100-175 only), `sdk/client.ts` (the catalog seed, accepted mints and shutdown), and
    `sdk/walletAdapter.ts` (head). Whether `useRoutstrFunds` (`knownProviders[node].mints`) and the send
    (`acceptedMintsForProvider`) can pick different mints was still not traced.
- White Noise: `WhitenoiseSetupBanner.tsx` beyond line 140, `WhitenoiseSetupScreen.tsx` beyond line 60, and the
  vendored marmot-ts (apart from its gift wrap timestamp).
- Map: `StatsCard.tsx` beyond its props.
- Outside the area but adjacent, not read: `BitchatBLEProvider.tsx`, the BitChat module and native bridges,
  `routstrStore.ts` (only the lines cited).
- Nothing was run on a device, against a relay, mint or Routstr node, and no test was run to confirm a finding.
  B4 and B5 are traced; B1's timing is from the libraries' source, not observed.
