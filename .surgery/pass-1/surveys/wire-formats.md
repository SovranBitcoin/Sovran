# Pass 1 survey: wire formats and replayable inputs

Branch `surgery/pass-1`, HEAD compared with v0.1.3 (`d9ad12c4b`). Read-only. `jg` was tried first and failed
(provider HTTP 402, "discovery incomplete"); everything below comes from grep, `git show`/`git diff` and reading.
Two claims were checked by running the real code with `bun` (marked **run**). Everything else was traced by reading
(**traced**) or is labelled **inferred**.

Paths are repo-relative. `A/` = `app/`, `W/` = `wallet/src/`, `N/` = `nostr/src/`. Line numbers are at HEAD unless
prefixed `0.1.3:`.

Library versions that set wire shapes are the same at both revisions: `@cashu/cashu-ts` 5.0.0-rc.4,
`@cashu/coco-core` 2.0.0, `@sovranbitcoin/schemas` 2.2.0, `coco-cashu-plugin-npc` 3.0.0, `nostr-tools` 2.24.2,
vendored marmot-ts (no diff), BitChat vendor commit `3be8fbf`. **New since 0.1.3:** a cashu-ts patch
(`A/patches/@cashu+cashu-ts+5.0.0-rc.4.patch`: NUT-18 `mp` / NUT-26 tag `0x09` encode+decode, `sm` / tag `0x0a`
throw), a coco-core patch (offline send, not a wire change), and `@routstr/sdk` 0.4.6 (replaces 0.1.3's hand-written
API-key client).

## (a) Inventory

| # | Format | Encoder (HEAD) | Decoder (HEAD) | Version marker | Tolerance | Test | Changed since 0.1.3 |
|---|---|---|---|---|---|---|---|
| 1 | OS URL schemes: `sovran`, `cashu`, `lightning`, `lnurl`, `lnurlw`, `lnurlp`, `bitcoin`, `nostr`, `nostrconnect` | other apps, QR, NFC | `A/app.json:7-17` registers all; `W/react/ColadaProvider.tsx:781-855` scans only `cashu` + `sovran` hosts (regex `:(?://)?([^/?#]+)`, 16 384-char cap); `A/features/send/providers/Colada.tsx:624-635` (`ignoredHosts: camera, expo-development-client`) | scheme only | other schemes ignored by design; host stops at `/ ? #` | `walletProviderLifecycle.test.tsx:116-224` (pins `bitcoin:` ignored, case, length cap) | No (Colada wiring and ColadaProvider effect unchanged in behaviour) |
| 2 | `nostrconnect://…` pairing link, and `…/connect?uri=<nostrconnect>` | client apps | `A/app/+native-intent.tsx:24-44` → `ticket` (in-memory slot, `A/features/nostrSigner/lib/pendingPairingUri.ts`) → `A/app/(signer-flow)/connect.tsx:35-73` | `nostrconnect://` scheme | bunker refused with its own message; >max length refused | `nip46PairingEntry.test.ts`, `nip46Uri.test.ts` | Yes, decoder only: 0.1.3 put the URI in a `uri` route param; HEAD holds it and passes a ticket. Both old link shapes still accepted. |
| 3 | Share route params (`/share?type&data&npub&lud16`) | in-app | `A/app/share.tsx`, `A/features/user/lib/shareRouteParams.ts` | none | allow-listed | `shareRouteParams.test.ts` (pass 0) | not re-read |
| 4 | Cashu token `cashuA`/`cashuB` (bearer or P2PK) | coco/cashu-ts `getEncodedToken` | `W/ecash.ts:44-80` (`decodeEcashTokenMetadata`), `W/parse.ts` | `cashuA`/`cashuB` prefix | cashu-ts; HEAD returns null for a token whose amount cannot be read (`W/ecash.ts:69-73`) | `extractCashuTokenLong.test.ts`, wallet unit tests | Decoder slightly stricter on unreadable amounts; encoder unchanged |
| 5 | Token hidden in an emoji (variation-selector bytes, cashu.me convention) | `A/shared/lib/third-party/emoji.ts:34-45` via `A/shared/lib/popup/popups/emojiPicker.tsx:28` | `emoji.ts:47-65` via `A/features/send/lib/sovranPaymentConfig.ts:704` (clipboard scan) | none | **breaks on VS16 carriers** (finding W2) | none real: `copyTokenAsEmoji.test.ts:16` mocks the codec; `app/e2e/core/run.test.ts:315` uses 😁 only | No |
| 6 | NUT-18 `creqA` (CBOR) and NUT-26 `creqB` (bech32m TLV) | `W/payment-request-receive.ts:113-131` (`encodeDisplay`), `:138-160`, `:186-205`; Coco `incoming.create` | cashu-ts `decodePaymentRequest` (patched), `W/payment-request.ts`, `W/payment-request-canonical.ts:118-132`, `W/parse.ts:236-245` | `creqA` / `creqb1` prefix | unknown CBOR keys and TLV tags ignored; null CBOR fields dropped (HEAD); `sm` / tag `0x0a` throw (HEAD) | `payment-request-codec-contract.test.ts`, `payment-request-canonical.test.ts`, `standing-payment-request.test.ts`, `nutCreq.test.ts` | Yes: HEAD may emit `mp`/`0x09` (0.1.3 ignores it, so reads it as strict); HEAD refuses `sm`; HEAD canonicalises other wallets' spellings |
| 7 | NUT-18 Nostr transport block `{t:'nostr', a:<nprofile>, g:[['n','17']]}` | `A/shared/lib/cashu/paymentRequestNostrTransport.ts:302-325`, hints `A/shared/lib/nostr/sendDirectMessage.ts:42-64` | other payers | — | — | `paymentRequestInboxPolling.test.ts` | Yes: hint order 0.1.3 `[vertexlab, damus, 8333.space]` → HEAD `[vertexlab, damus, nos.lol]` (W4) |
| 8 | **NUT-18 PaymentRequestPayload JSON** `{id, mint, unit, proofs}` in a NIP-17 gift wrap | `W/operations/defaultOperations.ts:1938-1961` | Coco `ingestPayload` (`node_modules/@cashu/coco-core/dist/index.js:1648-1671`, `parsePayload`, `validatePayload`) fed by `paymentRequestNostrTransport.ts:167-219`; `withDefaultUnit` `:97-107` | none (NUT shape) | Coco: `id` must equal an active op's request id; missing `unit` filled by HEAD | encode: `wallet/__tests__/unit/default-operations.test.ts:240-300`; decode: `paymentRequestPayloadUnit.test.ts`, `paymentRequestNostrRetry.test.ts` | **Yes, encoder: 0.1.3 sent `id` = the whole encoded request and `amount` as strings (W1)** |
| 9 | DM publish relay choice for payment DMs | `sendDirectMessage.ts:129-176` | — | — | HEAD: hints, else recipient `kind:10050`, else refuse (`NoDirectMessageRelaysError`); 0.1.3: hints, else own 5 relays | `nip17DmRelays.test.ts`, `dmRelayDiscovery.test.ts` | Yes (HEAD refuses where 0.1.3 guessed; caller rolls back, safe) |
| 10 | Contact ecash DM: NIP-17 kind-14 rumor whose content is a bare token | `A/shared/lib/nostr/publishGiftWrappedDM.ts:41-67`, `A/shared/lib/nostr/nip17.ts:156-200` | HEAD `A/features/payments/lib/dmEcashIntake.ts:66-140` (auto-queue); 0.1.3 chat bubble only | none | whole-message token only; locked-to-other ignored; oversize left for paste | `publishGiftWrappedDM.test.ts`, `dmEcashIntake.test.ts`, `nip17.test.ts` | Encoder no; HEAD adds auto-intake (also of old history) |
| 11 | P2PK lock in tokens (NUT-11) | `W/p2pk/lock.ts` (timed locks refused while `P2PK_RECLAIM_ENABLED` off) | `W/p2pk/conditions.ts`, `classifyMeshToken` | NUT-10 | malformed lock → hard error | `p2pkLock.test.ts`, wallet p2pk tests | New module; HEAD sends plain locks to contacts, readable by 0.1.3 (inferred: 0.1.3 keyring holds the nostr key via the p2pk-import plugin) |
| 12 | **Nearby capability** `sovran:nearby:1:` + signed kind-21118 event, content `{protocol:'sovran-nearby', version:1, noiseKey, expiresAt, creq}` over a BitChat Noise DM | `A/features/nearPay/lib/nearbyCapability.ts:43-70` | `nearbyCapability.ts:72-130` | prefix `:1:` + `protocol` + `version: literal(1)` | unknown fields stripped; v2 → null (peer not payable) | `nearbyCapability.test.ts` | New since 0.1.3 |
| 13 | **Nearby payment** `sovran:payment:1:` + NUT-18 payload JSON over BLE, same bytes over Nostr | `A/features/nearPay/lib/nearbyPayments.ts:264-320` | `nearbyPayments.ts:114-145` (`ingest`), `:173-241` (`receive`), schema `:31-44` (`unit: literal('sat')`) | prefix `:1:` | unknown fields stripped for checks, raw bytes to Coco | `nearbyPayments.test.ts` (encode and decode pinned separately, not chained) | New since 0.1.3 |
| 14 | Legacy Nut Drop: native favorite `[FAVORITED]:<npub>[:<creq>]` + pure-token BLE DM | native `ios/BitChatBLEBridge.swift:541-560, 781-800`, `android/…/BitChatBLEBridge.kt:489-500`; HEAD sends `creq: null` (`A/features/nearPay/hooks/useNearbyDiscovery.ts:257-262`, `A/modules/bitchat-module/src/BitChatModule.ts:149-175`) | HEAD: favorite identity ignored for payment (`useNearbyDiscovery.ts:179-185`); pure-token DM still redeemed (`useNutDropAutoRedeem.ts:84-128`) | none | — | `bitchatNativeEvents.test.ts`, `nutDropRedeemQueue*.test.ts` | Yes: HEAD stops advertising `creq`, and wallet discovery moved to its own BLE service UUID (W3) |
| 15 | NFC Type 4 NDEF Text record (token write; creq/token read) | `A/shared/lib/nfc/ndef.ts:20-60` (`buildTextNdef`), `write.ts`, `write-token.ts` | `ndef.ts:197-246` (`decodeNdefText`: Text, URI, MIME, external; first record only) | none (NDEF) | HEAD decoder accepts more record types; refuses chunked | `nfcNdefDecode.test.ts`, `nfcWriteOrdering.test.ts`, `nfcReadLengths.test.ts`, `nfcSessionBoundary.test.ts` | Written bytes unchanged; HEAD reads the tag's CC first; iOS AID order swapped (`A/app.json:82`) |
| 16 | BIP-321 unified QR `bitcoin:<addr>?lightning=&lno=&creq=` | `W/bip321.ts:99-131` | `W/parse.ts:338-…` (`parseBip321Container`, keys incl. `creq`, `cashu`, `token`) | none | HEAD params object is null-prototype; bare P2PK key accepted | wallet parse tests | Builder unchanged; parser more tolerant |
| 17 | NIP-46 signer RPC (kind 24133) | `A/features/nostrSigner/lib/nip46Engine.ts` | same | NIP-46 | — | `nip46*.test.ts` (25 files) | Wire unchanged (only error logging) |
| 18 | Whitenoise / Marmot MLS (kinds 443/445, 10051) | vendored marmot-ts | vendored | MLS | — | `whitenoiseStorage.test.ts` (JSON stand-in) | No (vendor unchanged; app wrapper lifecycle only) |
| 19 | Own replaceables: kind 0, 3, 10002, 10000 mute list (NIP-44 private, NIP-04 read) | `A/shared/lib/nostr/moderation.ts:190-260`, profile publish | `moderation.ts:40-110` | NIP | refuses to replace unreadable encrypted entries | `moderation*.test.ts`, `useOwnEventsSync.test.tsx` | No (types only) |
| 20 | Token memo with `nprofile1…` mentions | `A/shared/lib/nostr/memoMentions.ts:82` | same file, regex | none | plain text | `sendMemoMention.test.ts` | No |
| 21 | nagg app-view envelope `{order, orderBy, events, aggregates, cursor}` | nagg server | `N/envelope.ts:40-125` | route `v1`/v2 envelope | HEAD: per-item tolerant; 0.1.3: all-or-nothing (W9) | nostr package tests (pass 0 `nostr.md`) | Decoder more tolerant at HEAD |
| 22 | Wallpaper catalog: kind 1063 files + kind 30078 album JSON (admin-published) | admin tooling | `N/recipes/wallpapers.ts` | none | loose objects, defaults | `recipes-wallpapers` tests | Read path moved to nagg; 0.1.3 also try/catch-tolerant |
| 23 | Routstr node API | 0.1.3: `Bearer <cashu token>` API key, `/wallet/topup` (`0.1.3:A/shared/lib/routstr/topUp.ts`); HEAD: SDK X-Cashu | HEAD `A/shared/lib/routstr/reclaim.ts:45-79` sweeps legacy keys via refund | none | refund body `RefundSpine.safeParse`; only 410 is final | `routstrAccountArchive.test.ts`, `routstrReclaim.test.ts`, `routstrTokenWire.test.ts` | Yes, by design; legacy balances kept reachable |
| 24 | npub.cash (NPC) | plugin 3.0.0, `A/shared/lib/cashu/npc.ts:24-40` | plugin | API v2 | — | `npcHost.test.ts`, `npcIdentity.test.ts` | No (host `npub.cash` at both) |
| 25 | Push payloads, backup files, theme files | — | — | — | — | — | None exist: no notifications dependency; backup is the mnemonic; SettingsStorageScreen exports a debug JSON dump that nothing imports |

## (b) Findings, ranked by harm

### W1. A 0.1.3 payer's NUT-18 Nostr payment can never be claimed by a HEAD receiver (money held in a pending send)

**Traced at both revisions; the Coco rejection path traced in the installed dist.**

- 0.1.3 encoder, `0.1.3:wallet/src/operations/defaultOperations.ts:1821-1831`:
  `const payload = { id: paymentRequest, mint: mintUrl, unit, proofs: token.proofs }`. `paymentRequest` is the
  whole encoded request string (same function: `paymentRequestLength: paymentRequest.length`,
  `getPaymentRequestInfo(paymentRequest)`). `token.proofs[].amount` are cashu-ts `Amount`s, which serialise as
  strings (**run**: `JSON.stringify({a: Amount.from(8)})` gives `{"a":"8"}`).
- HEAD encoder, `W/operations/defaultOperations.ts:1944-1955`: `id: info.requestId`, numeric amounts, the
  request's spelling of the mint. Fixed in `ae7e1cc3d`, which is after v0.1.3.
- Decoder (same at both revisions), Coco 2.0.0 `ingestPayload` (`dist/index.js:1648-1666`):
  `getActiveByRequestId(payload.id)` with `id = "creqA…"` finds nothing →
  `PaymentRequestError("No active payment request found for id creqA…")`. String amounts would be accepted
  (`Amount.from("8")` works, **run**), so `id` is the only blocker.
- HEAD transport, `A/shared/lib/cashu/paymentRequestNostrTransport.ts:190-217`: the throw lands in `catch`, which
  sets `recoveryNeeded` and does not add the wrap to `seenWraps`. The same wrap is unwrapped and refused on every
  15 s poll for as long as it is inside the read window.
- Concrete payload that a shipped 0.1.3 install sends to a HEAD user's receive-hub QR:
  `{"id":"creqApWF0gaNhdGVub3N0…","mint":"https://mint.example","unit":"sat","proofs":[{"id":"00ad…","amount":"8","secret":"…","C":"02…"}]}`
- Harm: the 0.1.3 Nostr path sends **bearer** proofs (no NUT-10 handling at
  `0.1.3:…/defaultOperations.ts:1780-1812`), and its send operation stays pending. The money is not spent and not
  received. It comes back only if the sender reclaims the pending send. The same payload is also unclaimable by a
  0.1.3 receiver, so this is a shipped 0.1.3 bug that HEAD has fixed for senders only.
- No test feeds a 0.1.3-shaped payload (an `id` that is an encoded request) to the receiver.
- Repair seam (for the owner): beside `withDefaultUnit`, rewrite an `id` that starts with `creq` to that request's
  decoded `id` before `ingestPayload`. The payload hash is computed from the parsed proofs, so dedupe is unaffected.

### W2. A token copied "as emoji" with 215 of the picker's emojis cannot be pasted back (both revisions)

**Run.** `A/shared/lib/third-party/emoji.ts:47-65` collects every variation selector after the first base
character. The picker hands the emoji itself to `encode` (`emojiPicker.tsx:28`, `openEmojiPicker.ts`: "the answer is
an option whose id is the emoji"). 215 entries in `emojiData.ts` carry U+FE0F (VS16), for example 🛡️ and ❤️; the
count is the same at 0.1.3. `decode` reads that VS16 as byte `0x0F`, so the result starts with U+000F.
`sanitizeInput` strips only zero-width characters (`W/normalize.ts:38-48`), and `parsePaymentInput` returns
`type: "unknown"`.

Check run with `bun` (scripts in the session scratchpad): 🥜 round-trips and parses as `payment`; 🛡️ and ❤️ fail to
round-trip and parse as `unknown`.

Harm: a bearer token sent this way is not redeemable by pasting into Sovran (or, **inferred**, any wallet using the
same decoder). The send stays pending until the sender reclaims it. Unchanged since 0.1.3. Not pinned: the only test
mocks the codec. Safe repair: drop a leading `0x0F` byte (a token's first byte is always `c`), or strip VS16 from the
carrier before `encode`.

### W3. Nut Drop between a 0.1.3 phone and a HEAD phone cannot happen in either direction (no money moves)

**Traced.**
- HEAD wallet discovery advertises on a private service UUID `7C6A0001-5A8B-4C9D-AE10-534F5652414E` unless a
  public-chat lease is held (`ios/BitChatBLEBridge.swift:352-356`, `android/…/BitChatBLEBridge.kt:219, 342`,
  `BitChatModule.ts:173`). 0.1.3 uses the stock BitChat UUID. Outside public chat the two never meet.
- Inside public chat, HEAD's native favorite carries no `creq` (`startBLE({creq: null})`,
  `useNearbyDiscovery.ts:257-262`). 0.1.3 needs `[FAVORITED]:<npub>:<creq>` before it will send
  (`0.1.3:A/features/nearPay/lib/startNearPaySend.ts:100-110`, `nearPaySendDecision.ts:56-72`), so it shows
  "Not ready for Nut Drop".
- HEAD needs a signed `sovran:nearby:1:` capability (`nearbyCapability.ts:123-130`), which 0.1.3 never sends. On
  the public mesh HEAD sends capabilities only to peers that already sent one (`useNearbyDiscovery.ts:195`), so a
  0.1.3 phone never gets one as a chat bubble.
- A pure-token BLE DM from 0.1.3 (for example one pasted by hand into chat) is still auto-redeemed by HEAD
  (`useNutDropAutoRedeem.ts:84-128`).

Result: the two releases fail closed. Nothing is sent, but 0.1.3 users see a HEAD peer as never ready and HEAD
users do not see 0.1.3 peers as payable. Worth a line in the release notes.

### W4. Receive requests made before the upgrade advertise relay hints Sovran does not read (partly inferred)

- 0.1.3 hints are `PAYMENT_RELAYS.slice(0,3)` = `[relay.vertexlab.io, relay.damus.io, relay.8333.space]`
  (`0.1.3:A/shared/lib/nostr/sendDirectMessage.ts:28-39`). HEAD reordered them to
  `[vertexlab, damus, nos.lol]` because "the first three … must be relays Sovran reads gift wraps from"
  (`sendDirectMessage.ts:44-53`).
- Sovran reads gift wraps through nagg, Primal and `DEFAULT_RELAYS` (damus, nos.lol, primal, nostr.mom, nostr.band)
  (`A/shared/lib/nostr/nostrTierConfig.ts:49`, `outbox/defaults.ts:14-20`). vertexlab is first in **both** releases'
  hints and is not in the relay tier.
- A standing request's QR is re-encoded from the persisted Coco operation's `encodedRequest`, keeping its transport
  (`W/payment-request-receive.ts:145-159`, `toStanding` `:209-229`). So an op created by 0.1.3 keeps advertising
  8333.space after the upgrade until it rotates (**inferred**: that the op survives the upgrade unrotated).
- Both releases' payers resolve on the first relay OK and then `pool.close()` (`sendDirectMessage.ts:164-175`;
  0.1.3 `:77-87`). If vertexlab answers first, the write to damus may be cut off (**inferred**: nostr-tools close
  semantics not checked, and nagg's ingest set beyond damus and nos.lol not checked).
- Harm if it happens: the payer's ecash sits on relays the receiver never reads, as a sent DM. The fix is a
  receiver-side change (read the relays you hint), not a wire change.

### W5. Sovran's own BLE formats filter only version 1, so any version 2 would leak into chat (forward compatibility)

The `:1:` prefixes are matched literally in six places: `A/shared/providers/BitchatBLEProvider.tsx:57-58` (chat
suppression), `ios/BitChatBLEBridge.swift:466, 830` and `android/…/BitChatBLEBridge.kt:439, 679` (DM-peer
recording), and `useNearbyDiscovery.ts:132, 243` (listeners). A future `sovran:payment:2:{…}` reaching a HEAD
install would be stored in the BitChat DM store and shown as a chat bubble holding locked proofs JSON, with the
sender recorded as a DM peer. The capability's inner `version: literal(1)` fails closed (peer not payable), but the
prefix filters do not. Before any v2 ships, suppress the whole `sovran:` namespace in all six places. No test pins
the suppression.

### W6. Six registered URL schemes do nothing (both revisions)

`app.json:7-17` registers `lightning`, `lnurl`, `lnurlw`, `lnurlp`, `bitcoin` and `nostr` with the OS, but the only
link consumer, ColadaProvider, accepts `cashu` and `sovran` (`ColadaProvider.tsx:801-812`). A test pins that
`bitcoin:` is ignored (`walletProviderLifecycle.test.tsx:157`). Tapping `lightning:lnbc…` or `bitcoin:bc1…?amount=…`
in another app opens Sovran with no payment flow; **inferred**: expo-router shows `+not-found` ("This screen isn't
available") or stays where it was.

Even if the schemes were accepted, the host regex `[^/?#]+` would drop `?amount=…&lightning=…` from BIP-321 links,
and would cut a standard-base64 `cashuA` token at its first `/` (**inferred**: some old wallets emitted standard
rather than url-safe base64). No money moves.

### W7. A `sovran://connect?uri=…` link also raises "deeplink-failed" (traced, not run)

HEAD's native intent rewrites `…/connect?uri=` for the router (`+native-intent.tsx:19, 29-36`).
`Linking.useURL()` (`Colada.tsx:624`) still delivers the raw OS URL, so ColadaProvider scans the host `connect` and
calls `onError` → `staticPopup('deeplink-failed')` while the signer sheet opens. The same happens for any
`sovran://<route>` other than `camera`. The pairing secret is not passed (only the host is scanned). No test.

### W8. HEAD refuses NUT-18 `sm` and NUT-26 tag `0x0a` (intended behaviour change)

From the patch, `fromRawRequest`: `if (t.sm !== void 0) throw …`; TLV `case 0x0a: throw …`. 0.1.3 silently ignored
these and could underpay a method-constrained request; HEAD fails closed. Pinned in
`payment-request-codec-contract.test.ts:38-62`. Listed so that pass 1 does not "simplify" it away.

### W9. 0.1.3's nagg decoder fails a whole page on one bad item (a constraint on nagg while 0.1.3 is in use)

`0.1.3:nostr/src/envelope.ts:43-63`: `events: z.array(NaggFeedEventSchema)` and
`aggregates: record(record(record(z.number())))`. One event missing `content`, or one aggregate value that is not a
number (for example `null`), fails the envelope, and that tier's page is lost. HEAD parses item by item
(`N/envelope.ts:40-77`). nagg must not emit such values while 0.1.3 installs remain. At HEAD,
`NaggIdentitySchema.reach.source` is a strict enum (`N/envelope.ts:194`); a new source value drops that identity
entry, not the page.

### W10. App-defined formats with no version marker

- The `[FAVORITED]:<npub>:<creq>` extension (Sovran's addition to BitChat's favorite). Having a `creq` was the
  capability signal; HEAD no longer sends one.
- Emoji tokens (a third-party convention, W2).
- The wallpaper and album catalog JSON (admin-published; read loosely at both revisions).

The new nearby formats (#12, #13) do carry versions.

### W11. A follow-up README says the opposite of the code (doc drift)

`A/patches/README.cashu-mints-preferred.md` says "NFC and Nostr request sends reject all NUT-10 conditions". HEAD
pays plain P2PK requests over Nostr (`W/operations/defaultOperations.ts:1843-1856, 1915-1922`) and rejects only
tagged conditions.

### W12. External timeline: `@npubx.cash` addresses (inferred)

0.1.0 and 0.1.1 used `npubx.cash` as the NPC host (`d23d07230:shared/lib/cashu/npc.ts:5`). HEAD's comment
(`A/shared/lib/cashu/npc.ts:7-16`) says upstream retires that domain on 2026-12-31. Lightning addresses handed out
by those releases stop resolving after that date. Not checked: whether any release published them in kind-0
`lud16`.

### Formats with no round-trip test

- Emoji token codec (#5): none.
- 0.1.3-shaped NUT-18 payload into the HEAD receiver (#8): none.
- Nearby payment (#13): encode and decode are pinned separately with hand-built payloads, never the encoder's bytes
  fed back to `ingest`.
- `sovran:` prefix suppression (W5): none.
- Colada deep link → route tree: none (already in the ledger's gates).

## (c) Checked and found safe

- **creqA/creqB, 0.1.3 reading HEAD:** the unpatched rc.4 TLV decoder has `default: break` for unknown tags, and
  CBOR decode ignores unknown keys, so `mp`/`0x09` is dropped and the request reads as strict. HEAD emits `mp` only
  when `mintsPreferred` is defined (patch `Qr`, `toRawRequest`).
- **HEAD paying a 0.1.3 request over Nostr:** HEAD sends `{id: requestId, unit, numeric amounts}` to the 0.1.3
  hints, which 0.1.3's Coco 2.0.0 accepts.
- **NFC:** written NDEF bytes are identical (`buildTextNdef` unchanged). HEAD's reader accepts a superset.
- **BIP-321 builder** unchanged; HEAD's parser still accepts the older `cashu=`/`token=` keys
  (`0.1.3:wallet/src/parse.ts:35-48`, unchanged list).
- **Contact token DM:** content is a bare token at both revisions (`publishGiftWrappedDM.ts` unchanged). HEAD's
  auto-intake refuses locked-to-other, invalid and oversized tokens before queueing.
- **`nostrconnect://`:** old and new link shapes still open the connect sheet; the secret no longer enters
  navigation state.
- **NIP-46, Whitenoise/Marmot, mute list, memo mentions:** wire unchanged.
- **Routstr:** 0.1.3's API-key balances are kept in `legacyAccounts` and swept by refund; only HTTP 410 counts as
  final (`reclaim.ts:64-69`).
- **NPC:** same host and plugin at both revisions.
- **Nearby capability decoder** fails closed on tampering, staleness, a fixed-amount request, a foreign Nostr target
  and unknown versions (`nearbyCapability.ts:72-130`, pinned).

## (d) Not read

- Coco internals beyond `ingestPayload`, `parsePayload`, `validatePayload` and `hashPayload`, and the coco-core
  patch.
- The vendored BitChat sources, marmot-ts, Routstr SDK internals and npubcash-sdk.
- The nagg server, and which relays nagg ingests (needed to settle W4).
- nostr-tools `SimplePool.close` semantics for in-flight publishes (W4).
- The expo-router handling of unknown-scheme URLs (W6).
- `W/legacy-ecash/*` and `A/shared/lib/nostr/reduxEraRoot.ts`: readers of older stored data, which belong to the
  stores survey.
- Mint info, `apiClient` and the feed spec sent to nagg (pinned in pass 0, not re-read).
- NIP-46 method handlers in depth.
- `A/shared/lib/qr.ts` (+81 lines, display sizing).

Nothing was run on a device. The only runs were the two `bun` checks for W2 and the `Amount` string check.
