# Nut Drop over bitchat

This module lets Sovran hand a Cashu token to a specific nearby Sovran peer over
the bitchat BLE mesh, fully offline. It deliberately stays on top of bitchat's
existing primitives:

- peer discovery and BLE packet fragmentation/reassembly;
- Noise XX private sessions;
- the native favorite notification;
- the native private-message packet.

The protocol adds one private wire extension and two bridge-level behaviors. It
does not add a packet type, a Noise payload type, an announce TLV, reserved
bytes, or a protocol-version bump.

## Current Contract

Nut Drop is Sovran-to-Sovran. Stock bitchat clients can still share the same mesh
and normal traffic, but they cannot decode Sovran's extended private messages and
must never receive token DMs.

The three protocol changes are:

1. **Extended private-message content length.** Vendored bitchat's
   `PrivateMessagePacket` content TLV is widened so a single private DM can carry
   a whole encoded Cashu token or a creq-bearing favorite.
2. **Favorite carries identity plus payment request.** The native favorite
   message becomes `[FAVORITED]:<npub>:<creq>`, where `npub` is the peer's Nostr
   identity and `creq` is a standing NUT-18 payment request advertising accepted
   mints and the P2PK lock key.
3. **Single-initiator handshake tie-breaker.** When both peers eagerly favorite
   each other, only the lexicographically lower 16-hex peerID initiates the Noise
   XX handshake. The higher peer waits and sends its favorite after the session is
   live.

The hard safety rule is: **token DMs go only to peers that advertised a valid
creq favorite.** A valid creq is the capability proof that the peer is patched
and can decode the extended private-message content length. Without that proof,
the app blocks the send before token creation or transmission.

## What Is Not Part Of The Protocol

These were earlier ideas or debugging patches and should not be reintroduced:

- no public mesh broadcast for token delivery;
- no bearer drop to stock or "vanilla" bitchat peers;
- no custom announce TLV for Nostr identity, Cashu capability, or mints;
- no new `NoisePayloadType`;
- no new packet type;
- no neighbor-gossip suppression;
- no signing-canonicalization patch;
- no wrapper around the token string.

The DM content is the standard encoded Cashu token string (`cashuA...` or
`cashuB...`) and nothing else.

## Wire Format

### Extended `PrivateMessagePacket.content`

Stock bitchat encodes private-message fields as TLV and uses a one-byte length
for `content`, capping content at 255 bytes. The BLE transport can already
fragment larger encrypted packets, so the cap is only a message-format cap.

Sovran keeps small messages byte-identical to stock:

| Content length | On the wire |
| --- | --- |
| `0x00` to `0xFE` | one length byte, then the content bytes |
| `0xFF` to `0xFFFF` | sentinel byte `0xFF`, two-byte big-endian length, then the content bytes |

`messageID` stays one-byte length. A message of 254 bytes or less remains stock
on the wire; only larger content enters the private extension path.

The Swift patch lives in `scripts/patch-bitchat-imports.js` and targets
`Protocols/Packets.swift`. The Android patch lives in
`scripts/sync-bitchat-android.js` and targets `model/NoiseEncrypted.kt`.

### Favorite Message

bitchat already shares Nostr identity through a private favorite notification:

```text
[FAVORITED]:<npub>
[UNFAVORITED]:<npub>
```

Sovran appends a NUT-18 standing payment request:

```text
[FAVORITED]:<npub>:<creq>
[UNFAVORITED]:<npub>:<creq>
```

Fields:

- `npub`: the sender's Nostr pubkey. It is the profile identity and, with a `02`
  prefix, the NUT-11 P2PK lock target.
- `creq`: a NUT-18 payment request. It is reusable, has no amount, has no
  transport, uses unit `sat`, advertises the sender's accepted mints, and carries
  `nut10 = { kind: "P2PK", data: "02" + <x-only npub hex>, tags: [] }`.

The receiver accepts the peer as token-DM-capable only if:

- the favorite contains an `npub`;
- the favorite contains a parseable `creq`;
- the `creq.nut10` key equals `02` + the decoded `npub`;
- sender and receiver share at least one mint before sending.

Implementation references:

- `shared/lib/nutCreq.ts` builds and validates creqs.
- `modules/bitchat-module/ios/BitChatBLEBridge.swift` emits/parses favorites on
  iOS.
- `modules/bitchat-module/android/src/main/java/expo/modules/bitchat/BitChatBLEBridge.kt`
  emits favorites on Android and reads the stored Android favorite identity.
- `features/nearPay/lib/nearPaySendDecision.ts` enforces the send decision.
- `features/send/lib/sovranPaymentConfig.ts` has the final delivery guard before
  `sendBLEPrivateMessageWhole`.

### Token DM

The token is delivered as one private Noise DM:

```text
content = <standard encoded Cashu token string>
```

Sender behavior:

- online + valid creq + shared mint: mint from a shared mint and P2PK-lock to
  `02` + recipient npub;
- offline + valid creq + shared mint: send a bearer token from the shared mint;
- no valid creq: block;
- no shared mint: block.

Receiver behavior:

- all proofs single-sig P2PK locked to my key: redeem;
- no P2PK locks: redeem as bearer because the private DM is addressed to me;
- any other lock, multisig, or mixed proof state: ignore.

Redeem must be idempotent. Dedupe by token. Never auto-trust a mint pushed by an
incoming token; park untrusted-mint tokens instead of silently adding the mint.

## Discovery And Handshake

bitchat announces do not carry Nostr identity, so Sovran learns identity and mint
capability by eagerly favoriting nearby peers while the nearby-pay surface is
mounted. This is intentionally active and bounded to the user looking for nearby
payments.

Eager mutual favoriting creates a Noise XX collision if both sides initiate at
the same time. The bridge fixes that without changing vendored Noise:

- both peers compare the same two 16-hex peerIDs;
- the lower peerID initiates;
- the higher peerID defers;
- both sides send or re-send the favorite once the single session establishes.

Favorites are remembered as standing intent for the current bridge lifetime.
When a Noise session re-establishes, the bridge re-sends the favorite so a peer
that restarted, reinstalled, or lost session state learns identity and creq again.

Android also ports iOS's re-handshake recovery into
`noise/NoiseSessionManager.kt`: if a fresh handshake init arrives while Android
still holds an established stale session, Android removes the stale session and
responds to the new handshake.

## Native Patch Inventory

All vendor behavior changes must live in the patch/sync scripts. Do not rely on
manual edits inside ignored generated vendor trees.

### iOS: `scripts/patch-bitchat-imports.js`

Patches the checked-out `ios/BitChatVendor` submodule in place.

Required patches:

- comment out `BitLogger`, `BitFoundation`, and `Tor` imports that are bundled
  or stubbed inside the Expo module;
- normalize scoped private Swift imports that conflict when all sources compile
  into one module;
- force the mainnet BLE service UUID in debug builds so Sovran dev clients share
  the public bitchat mesh;
- de-privatize `BLEService.linkState(for:)` so the bridge can expose
  `hasDirectLink`;
- extend `PrivateMessagePacket.content` with the `0xFF` sentinel length;
- keep directed fragment packet frames below the BLE/GATT 512-byte boundary.

The fragment-headroom patch is critical for iOS to Android long-message delivery.
The observed failure was a directed iOS fragment encoding to 513 bytes; Android
received only 512 bytes, then `BinaryProtocol` failed because the declared
payload length exceeded the bytes present. The iOS patch leaves explicit wire
headroom before fragmenting.

At the current iOS pin, the optional sender-mismatch guard patch is skipped
because that upstream file is absent.

### Android: `scripts/sync-bitchat-android.js`

Copies a headless subset of `android/BitChatVendor` into generated
`android/vendor-src`, applying anchored patches during copy.

Required patches:

- widen `BluetoothMeshService.encryptionService` access so the bridge can reset
  private chats;
- remove the Android 12+ location-permission requirement from BLE startup,
  matching the manifest's `neverForLocation` BLE scan posture;
- make Bluetooth startup return a real success/failure value instead of logging
  `ble_start_ok` while server/client startup failed later;
- make `BluetoothMeshService.startServices()` return that boolean;
- fix Android binary header constants to v1 = 14 bytes and v2 = 16 bytes;
- fix Android fragment-size math to use those same header sizes;
- port iOS's stale-session re-handshake recovery;
- extend `PrivateMessagePacket.content` with the `0xFF` sentinel length.

The Android header-size patch is paired with the iOS fragment-headroom patch. If
either side is missing, iOS-to-Android long token DMs can fail at the first
fragment.

## Bridge And Runtime Changes

The bridge code is part of the protocol surface even when it does not patch
vendored bitchat.

Critical bridge behavior:

- deterministic profile-scoped BitChat identity is installed before the native
  mesh starts;
- `startBLE` accepts the active profile's Nostr/P2PK material plus the standing
  creq;
- same profile + same identity start calls update nickname/creq without clearing
  the previous creq;
- profile changes stop and recreate the native service, clearing identity maps
  and favorite intent;
- `sendBLEFavorite` sends `[FAVORITED]:<npub>:<creq>`;
- inbound favorites update `BLEPeer.nostrPubkeyHex`, `BLEPeer.creq`, and
  `onBLEPeerIdentity`;
- Android queues private sends while a Noise handshake is pending, because
  upstream Android drops content if `sendPrivateMessage` is called before a
  session exists;
- Android encrypted identity prefs self-heal only for the profile-scoped BitChat
  stores when `EncryptedSharedPreferences` corruption is detected.

Critical JS behavior:

- `useEagerPeerFavorite` sends favorites for discovered peers while nearby-pay UI
  is mounted;
- `lockableMintsFromCreq` is the capability gate;
- `planNearPaySend` blocks missing or invalid creqs and no-shared-mint cases;
- `NearPaySession` carries the recipient creq as capability proof;
- `deliverNearPayIfActive` refuses to transmit if the active recipient has no
  creq;
- `sendBLEPrivateMessageWhole` sends the whole token as one DM, not app chunks;
- `useNutDropAutoRedeem` classifies private token DMs and suppresses raw token
  chat bubbles.

## Vendor Versions And Build Path

The scripts bake the vendored submodule commit into generated native constants:

- iOS: `ios/BitchatVendorVersion.swift`;
- Android: `android/src/main/java/expo/modules/bitchat/BitchatVendorVersion.kt`.

`startBLE` logs this as `vendorVersion` in `bitchat.peers.ble_start_ok`. A
correct current build should show:

| Platform | Expected vendor version |
| --- | --- |
| iOS | `3be8fbf` |
| Android | `4dfec91` |

If logs show `unknown` or an unexpected SHA, the installed native build is stale
or the build archive did not preserve the generated version file.

The app depends on this module as `file:./modules/bitchat-module`, so local
`node_modules/bitchat-module` can become stale after editing the source module.
`bun install` refreshes that copy and runs the postinstall patch/sync scripts.
Before making native dev builds, make sure the copied dependency is in sync or
run the source and copied scripts directly.

## Build And Verification Checklist

From `sovran-app`:

```bash
bun install
node modules/bitchat-module/scripts/patch-bitchat-imports.js
node modules/bitchat-module/scripts/sync-bitchat-android.js
node node_modules/bitchat-module/scripts/patch-bitchat-imports.js
node node_modules/bitchat-module/scripts/sync-bitchat-android.js
```

Expected script output includes:

```text
[patch-bitchat-imports] vendor version: 3be8fbf
[sync-bitchat-android] vendor version: 4dfec91
```

Spot-check the generated patches:

```bash
rg -n "extended content length|extended length read|Keep each encoded fragment packet|directNeighbors: connectedPeerIDs" \
  modules/bitchat-module/ios/BitChatVendor/bitchat/Protocols/Packets.swift \
  modules/bitchat-module/ios/BitChatVendor/bitchat/Services/BLE/BLEService.swift

rg -n "HEADER_SIZE_V1 = 14|HEADER_SIZE_V2 = 16|val headerSize = if \\(version == 2\\) 16 else 14|extended content length|re-handshake recovery" \
  modules/bitchat-module/android/vendor-src
```

Run the focused guards:

```bash
bun run test -- __tests__/nearPaySendDecision.test.ts __tests__/nearPayPeerProfile.test.ts __tests__/nearPayStore.test.ts __tests__/clearPaymentContext.test.ts __tests__/sovranPaymentConfig.profile.test.ts __tests__/nutCreq.test.ts __tests__/bitchatAndroidNativeSource.test.ts --runInBand
bun run type-check
```

Native changes require rebuilding the dev clients. A JS reload is not enough.
After installing the rebuilt apps, open the nearby/radar surface and confirm
`bitchat.peers.ble_start_ok.vendorVersion` on both devices before testing token
delivery.

## Troubleshooting

### Peers do not discover each other

Check these first:

- both phones have Bluetooth powered on and permissions granted;
- both apps are on the mainnet service UUID;
- Android `startBLE` did not fail native startup;
- logs contain `bitchat.peers.ble_start_ok` with the expected vendor version;
- the nearby/radar surface is open, because BLE startup is explicit and bounded
  to discovery surfaces.

### Peers discover but do not become token-ready

Look for favorite exchange logs and peer snapshots:

- `near_pay.favorite.send` means JS asked native to favorite a peer;
- `onBLEPeerIdentity` and `BLEPeer.creq` mean the peer reciprocated;
- `near_pay.peer.not_ready` means the app refused to create a token because the
  peer has not advertised a valid creq.

This is expected for stock bitchat clients and stale Sovran builds.

### iOS to Android long messages or tokens fail

First verify `vendorVersion` on both devices. Then inspect Android logs around
fragment handling:

- a healthy token DM should receive every fragment and reassemble;
- `BinaryProtocol` decode failure on a 512-byte packet, especially before
  fragment 2 arrives, points at the iOS fragment-headroom or Android header-size
  patches not being present in the installed native build.

### Android logs `poweredOn` but no peers appear

This usually means native Android BLE startup failed after JS thought Bluetooth
was available. The Android sync script patches permission/startup behavior so
`startServices()` returns real failure and the Expo bridge throws
`BitChatStartFailedException` instead of logging a false `ble_start_ok`.

### Android reinstall breaks identity or sessions

The bridge installs deterministic profile-scoped keys. If encrypted Android
BitChat prefs become unreadable after reinstall/keychain changes, the installer
self-heals only the scoped BitChat encrypted prefs and reinstalls deterministic
identity. If a peer restarts with a fresh Noise state, Android accepts the fresh
handshake by removing the stale established session, matching iOS behavior.

## Upstream Context

The current design intentionally keeps the protocol small. These GitHub threads
are the ones most likely to let Sovran remove or replace patches later:

- [permissionlesstech/bitchat#784](https://github.com/permissionlesstech/bitchat/issues/784):
  upstream request to allow private-message content above 255 bytes.
- permissionlesstech/bitchat-android#506: Android-side two-byte TLV direction
  similar to Sovran's length widening.
- permissionlesstech/bitchat#1053: proposed Lightning/Cashu payment packets at
  the Noise layer.
- permissionlesstech/bitchat#1327: maintainer-side cashu long-message guard
  work.
- [permissionlesstech/bitchat#1073](https://github.com/permissionlesstech/bitchat/issues/1073)
  and [permissionlesstech/bitchat#124](https://github.com/permissionlesstech/bitchat/issues/124):
  SDK and interop discussions.
- [permissionlesstech/bitchat#416](https://github.com/permissionlesstech/bitchat/issues/416),
  [permissionlesstech/bitchat#417](https://github.com/permissionlesstech/bitchat/issues/417),
  permissionlesstech/bitchat-android#132, and
  [permissionlesstech/bitchat#679](https://github.com/permissionlesstech/bitchat/issues/679):
  prior Cashu-over-bitchat attempts and references.
