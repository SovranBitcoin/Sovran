# Cashu over bitchat — compatibility & interop guide

> **Who this is for:** anyone building a wallet or bitchat client that wants to
> send/receive Cashu ecash to/from Sovran over the bitchat BLE mesh, and wants
> to know exactly which bytes to match and whether they have to fork
> [`permissionlesstech/bitchat`](https://github.com/permissionlesstech/bitchat)
> / [`bitchat-android`](https://github.com/permissionlesstech/bitchat-android)
> to do it.
>
> This is the **interop contract**. The companion doc
> [`nut18-bitchat-transport.md`](./nut18-bitchat-transport.md) covers the
> protocol rationale. Nothing here is posted to any upstream repo automatically.

---

## TL;DR

Sovran pays a nearby peer by **delivering a whole Cashu token as a single private
Noise DM to that peer**, optionally **P2PK-locked to the peer's Nostr identity**
when the two share a mint and the sender is online. It learns the peer's Nostr
identity **and** its accepted mints through **bitchat's own native favorite
notification** — it does **not** invent any wire format (no announce TLV, no new
packet type, no new Noise payload type). Concretely:

- **Identity + capability exchange:** a peer's Nostr pubkey **and** a NUT-18
  payment request (`creq…`) arrive together in bitchat's `[FAVORITED]:<npub>:<creq>`
  private message — the only native mesh mechanism bitchat has for sharing a Nostr
  identity. The creq advertises *which mints the peer accepts* and carries its
  P2PK lock key, so two Sovran peers recognise each other **and** agree on a mint.
- **Delivery:** the whole token is sent as a **single private Noise DM** to the
  peer (encrypted to them — the payment stays private). The 255-byte
  private-message cap was a *message-format* limit, so Sovran widens its own
  content-length field (0xFF sentinel + 2-byte length); ≤254 B stays byte-for-byte
  identical to stock, so only our own clients decode the larger DM.

That Nostr key is the peer's whole identity: it's the kind-0 profile key **and**,
`02`-prefixed, the NUT-11 P2PK lock target. Identity = Nostr identity = P2PK
target, one value; the creq adds the accepted-mint list the key alone can't carry.

Payments are **Sovran↔Sovran**: a stock client can't decode our extended DM (or
our creq-bearing favorite), and has no P2PK redeem path anyway. To interoperate a
client needs the things in §3.

---

## 1. The mesh you're joining

Sovran runs on the **mainnet** bitchat BLE service UUID —
`F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C` — the same mesh as App Store / Play Store
bitchat. (Stock advertises a testnet UUID `…4B5A` in DEBUG builds; Sovran forces
mainnet in every build so dev clients share the real mesh. Force mainnet in your
debug build too, or you won't discover each other.)

Everything below assumes you're already a working bitchat peer: you announce,
you run Noise sessions, you fragment/reassemble packets.

## 2. The wire contract

### 2.1 Identity + capability exchange — the native favorite notification

bitchat shares a user's Nostr identity over the mesh in exactly one place: when
peer A favorites peer B, A sends B a **Noise-encrypted private message** whose
content is `[FAVORITED]:<A's npub>` (`[UNFAVORITED]:<npub>` to revoke). The
receiver stores `B's-noise-key → npub`. (`BLEService.sendFavoriteNotification` on
iOS; `MessageHandler.handleFavoriteNotificationFromMesh` on Android.) It is
**directional**: to learn peer B's key, **B must favorite you**.

Sovran rides this unchanged, appending a **NUT-18 payment request**:

```
content = "[FAVORITED]:" + npub + ":" + creq      (favorite)
          "[UNFAVORITED]:" + npub + ":" + creq    (revoke)

npub  : the sender's bech32 Nostr pubkey ("npub1…")  — its x-only secp256k1
        key is the kind-0 profile key AND (02-prefixed) the P2PK lock target.
creq  : a NUT-18 standing payment request ("creqA…", URL-safe base64, no ":").
        Advertises the sender's accepted mints, and carries a `nut10` P2PK
        lock to `02`+npub. REQUIRED to be treated as lockable.
```

**Why the creq is load-bearing (and why it replaced a bare `:nut` flag).** A flag
says only "cashu-capable"; the creq additionally says *which mints I accept* and
*what key to lock to*. That lets a sender lock **only to a shared mint** (or block
the send when there's no overlap) instead of producing an unredeemable token. A
peer is **eligible for token DMs only when its favorite carries a valid creq**
whose `nut10` key equals `02`+npub; anything else is treated as unconfirmed.
Build/parse it with
`@cashu/cashu-ts` (`buildStandingCreq`/`parseCreq` in `shared/lib/nutCreq.ts`):
no transport, no amount, reusable, mints capped at 5 to bound size. This mirrors
[numo](https://github.com/cashubtc/numo)'s mint-advertisement-via-payment-request.

**Parser compatibility.** The favorite is now Sovran-only by construction: with a
creq appended it exceeds 255 bytes, so it rides the extended private-message
length (§5) that only our clients decode — a stock client never sees it (and so
never stores a malformed npub, the old `:nut` wart). The creq is base64 with no
`:`, so splitting `content` on `:` recovers `[1]=npub`, `[2…]=creq` cleanly.

### 2.2 Discovery is eager

bitchat never advertises a Nostr key in its announce, so there is no passive way
to learn a peer's identity — you must exchange favorites. Sovran therefore
**favorites every peer it discovers** while the nearby-pay radar is open: a Sovran
peer reciprocates and both become lockable-on-sight. Sending a favorite before a
Noise session exists is fine — bitchat queues it and triggers the handshake.
Because eager *mutual* favoriting makes both peers initiate the Noise XX handshake
at once (a collision — XX needs exactly one initiator), the **lower-peerID side
initiates** and the higher side defers.

### 2.3 Delivery — the whole token as one private Noise DM

To pay a peer (`planNearPaySend` + `sendBLEPrivateMessageWhole`):

1. Read their npub + accepted mints from their creq favorite.
2. Decide the token: **online + a shared mint + valid creq** → P2PK-lock
   (NUT-11, single-sig) to `02`+npub, minted from a shared mint; **offline +
   valid creq + shared mint** → bearer from that shared mint; **no valid creq** or
   **no shared mint** → block the send (a stock/stale peer may drop an extended DM,
   and a token from a mint they don't accept is unredeemable).
3. Send the whole token as a **single private Noise DM** to that peer (not the
   public mesh). The DM is encrypted to the recipient, so locked *or* bearer the
   payment stays private.

### 2.4 Receiver classification

A token arrives in a private DM addressed to you. Classify it against your key:

| Classification | Condition | Action |
| --- | --- | --- |
| **locked-to-me** | every proof is single-sig P2PK to *my* key | redeem (auto; untrusted mint → park, never auto-swap) |
| **bearer** | no P2PK locks | redeem (the DM is addressed to me, so it's mine) |
| **locked-to-other** | any proof locked to a different key / multisig / mixed | **ignore** (shouldn't reach a DM to me) |

Pure-token DMs are suppressed from the chat thread so a payment never renders as a
raw-token bubble. Delivery is best-effort over the mesh; there is no status reply.

## 3. Do you have to modify bitchat?

| Capability | Unmodified bitchat | What it needs |
| --- | --- | --- |
| Discover Sovran on the mesh | ✅ (same mainnet UUID) | — |
| See/decode our creq favorite | ❌ (>255 B, extended length) | the extended private-message length (§5) |
| Receive our token DM | ❌ (>255 B, extended length) | the extended private-message length (§5) |
| Advertise a lockable identity to us | ❌ (never sends a creq) | send `[FAVORITED]:npub:creq` (§2.1) |
| **Redeem a token we locked _to them_** | ❌ (no P2PK redeem path) | a Cashu wallet + the creq favorite |
| Send us a locked token | ❌ (no compose path) | learn our creq + lock + DM (§2.3) |

**Bottom line:** payments are Sovran↔Sovran — a stock client decodes neither our
creq favorite nor our extended token DM, and has no P2PK redeem path. To become a
*full* peer a client needs exactly four things, **none of which require an
upstream protocol change** (the one wire change, the extended length, is
backward-compatible and client-local):

1. **Implement** the extended private-message content length (§5).
2. **Emit** `[FAVORITED]:npub:creq` to peers (and eagerly, to be discoverable).
3. **Parse** inbound creq favorites → record peer→npub + accepted mints; treat a
   missing/mismatched creq as not-lockable.
4. **Classify + redeem** inbound token DMs, and **compose** locked tokens (or
   offline bearer tokens after a valid creq) and DM them to the peer.

### 3.1 What Sovran patches in the vendored bitchat (and what it does NOT)

The identity exchange reuses native mechanisms, so the favorite send/receive is
done in Sovran-owned bridge code (`BitChatBLEBridge.swift` / `.kt`) calling the
public `sendPrivateMessage`. The **one** wire patch is the extended
private-message content length (§5) in `Packets.swift` / `NoiseEncrypted.kt`,
applied by the patch/sync scripts — backward-compatible (≤254 B is byte-identical
to stock) and decoded only by our clients. The remaining vendor patches are
integration plumbing: import fix-ups, mainnet-UUID forcing, `linkState` /
`encryptionService` access widening for the bridge, Android BLE permission/start
alignment, Android re-handshake recovery matching upstream iOS behavior, and
(when present at a vendor pin) a temporary relaxation of an announce
sender-mismatch check for older App Store builds. There is **no** announce-TLV
patch, **no** neighbor-gossip suppression, **no** new packet/payload type, and
**no** signing-canonicalization patch.

## 4. Why this is "the bitchat way"

The design goal is to touch the bitchat protocol as little as possible:

- No new announce TLV, no new packet type, no new Noise payload type, no
  protocol-version bump, no reserved bytes. The only wire change is a length field
  we widen for our own clients (≤254 B stays byte-identical to stock).
- Identity + capability travel on the favorite notification bitchat already
  ships; the token travels on the private Noise DM bitchat already encrypts.
- A standard NUT-18 creq carries capability + mints, instead of an invented flag.

The trade is that discovery is **active** (you favorite peers) and
**relationship-gated** (you only hold keys for peers you've exchanged favorites
with) — there is no passive lockable-on-sight, because bitchat deliberately keeps
Nostr keys out of the announce.

## 5. The 255-byte cap was a message-format limit — so we widened our own

bitchat private messages carried content in a TLV with a **one-byte length** —
a 255-byte cap that `PrivateMessagePacket.encode()` enforced by `return nil`ing
above 255. That's a *message-format* limit, not a radio one: the transport
already fragments oversized encrypted packets. Since we control both ends, Sovran
widens its own content-length field, backward-compatibly:

- content length `0x00–0xFE` → a literal 1-byte length (byte-identical to stock);
- `0xFF` → a sentinel, followed by a 2-byte big-endian length (≤64 KB).

A message ≤254 B is exactly stock on the wire; only a Sovran peer decodes a
>254 B message. This single change carries **both** the whole-token DM and the
creq-bearing favorite. (See bitchat #784 for the stalled upstream effort to lift
the cap protocol-wide; we don't depend on it landing. The bitchat-android
*Feat/dm 2byte tlv* PR #506 is the same idea.)

## 6. Reference implementation

Sovran (this repo): the creq build/parse + capability gate in
`shared/lib/nutCreq.ts`; the send decision in
`features/nearPay/lib/nearPaySendDecision.ts`; the favorite send/receive (npub +
creq) in `modules/bitchat-module/ios/BitChatBLEBridge.swift` and
`android/src/main/java/expo/modules/bitchat/BitChatBLEBridge.kt`; the extended
private-message length in the `scripts/patch-bitchat-imports.js` /
`scripts/sync-bitchat-android.js` patches; the whole-token DM in
`features/bitchat/lib/blePrivateDelivery.ts` (`sendBLEPrivateMessageWhole`); the
JS surface (`BLEPeer.nostrPubkeyHex` + `BLEPeer.creq`, `onBLEPeerIdentity`) in
`modules/bitchat-module/src/`; receive/redeem in
`features/nearPay/hooks/useNutDropAutoRedeem.ts` (locked-to-me OR bearer) with
chat suppression in `shared/providers/BitchatBLEProvider.tsx`; token
classification in `@sovranbitcoin/colada` (`classifyMeshToken`) and mint
selection via `selectMint`'s `allowedMints`.
