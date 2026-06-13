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

Sovran pays a nearby peer by **P2PK-locking a Cashu token to the peer's Nostr
identity, then broadcasting that locked token on the public mesh.** It learns
the peer's Nostr identity through **bitchat's own native favorite notification**
— it does **not** invent any wire format (no announce TLV, no new packet type,
no new Noise payload type). Concretely:

- **Identity exchange:** a peer's Nostr pubkey arrives in bitchat's
  `[FAVORITED]:npub` private message — the only native mesh mechanism bitchat
  has for sharing a Nostr identity. Sovran appends a `:nut` capability marker
  (`[FAVORITED]:npub:nut`) so two Sovran peers recognise each other.
- **Delivery:** the locked token is broadcast as an ordinary **public** mesh
  message (already fragmented; stock bitchat already renders a `cashu…` token
  as a redeemable chip). A P2PK-locked token is safe in the open — only the
  locked key can redeem it.

That Nostr key is the peer's whole identity: it's the kind-0 profile key **and**,
`02`-prefixed, the NUT-11 P2PK lock target. Identity = Nostr identity = P2PK
target, one value.

If you do nothing, an unmodified bitchat client still **sees** our broadcast
tokens (they render as a normal cashu chip) — it just can't redeem a P2PK-locked
one and never advertises a key for us to lock to. To be **fully** interoperable
a client needs the three things in §3.

---

## 1. The mesh you're joining

Sovran runs on the **mainnet** bitchat BLE service UUID —
`F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C` — the same mesh as App Store / Play Store
bitchat. (Stock advertises a testnet UUID `…4B5A` in DEBUG builds; Sovran forces
mainnet in every build so dev clients share the real mesh. Force mainnet in your
debug build too, or you won't discover each other.)

Everything below assumes you're already a working bitchat peer: you announce,
you run Noise sessions, you fragment/reassemble public messages.

## 2. The wire contract

### 2.1 Identity exchange — the native `[FAVORITED]:npub` favorite notification

bitchat shares a user's Nostr identity over the mesh in exactly one place: when
peer A favorites peer B, A sends B a **Noise-encrypted private message** whose
content is `[FAVORITED]:<A's npub>` (`[UNFAVORITED]:<npub>` to revoke). The
receiver stores `B's-noise-key → npub`. (`BLEService.sendFavoriteNotification` on
iOS; `MessageHandler.handleFavoriteNotificationFromMesh` on Android.) It is
**directional**: to learn peer B's key, **B must favorite you**.

Sovran rides this unchanged, with one addition — a **capability marker**:

```
content = "[FAVORITED]:" + npub + ":nut"      (favorite)
          "[UNFAVORITED]:" + npub + ":nut"    (revoke)

npub  : the sender's bech32 Nostr pubkey ("npub1…")  — its x-only secp256k1
        key is the kind-0 profile key AND (02-prefixed) the P2PK lock target.
:nut  : a literal marker meaning "I am a cashu wallet that can redeem
        P2PK-locked tokens". REQUIRED to be treated as lockable.
```

**Why the `:nut` marker is load-bearing.** A *stock* bitchat user who favorites
you sends a bare `[FAVORITED]:npub` carrying their bitchat Nostr identity — but
they can't redeem a P2PK-locked Cashu token. If you locked ecash to that key the
funds would be stuck. So a peer is **lockable only when its favorite carries
`:nut`**; a bare favorite is treated as bearer-only.

**Parser compatibility (important for implementers).** The two stock clients
parse the npub differently, and `:nut` must survive both:

- **iOS** splits the content on `:` and takes field 1 → `npub` (field 2 `nut`
  is ignored by stock; Sovran reads it for the capability gate).
- **Android** uses `content.substringAfter(":")` → it stores the whole
  `npub:nut`. Read the `:nut` suffix back off the stored value: a stored value
  ending in `:nut` is cashu-capable (strip it, then bech32-decode the npub); a
  bare `npub` is not.

Put the marker **after** the npub (`npub:nut`), never before, so both stock
parsers still recover a usable npub. (One known wart: stock **Android** stores
the literal `npub:nut`, so a stock Android user who favorites a Sovran user ends
up with a malformed npub for us — harmless to Sovran, and they couldn't redeem
our ecash anyway.)

### 2.2 Discovery is eager

bitchat never advertises a Nostr key in its announce, so there is no passive way
to learn a peer's identity — you must exchange favorites. Sovran therefore
**favorites every peer it discovers** while the nearby-pay radar is open
(`useEagerPeerFavorite`): a Sovran peer reciprocates and both become
lockable-on-sight; a stock peer simply sees a normal "favorited you" and never
reciprocates with a `:nut` favorite (→ bearer only). Sending a favorite before a
Noise session exists is fine — bitchat queues it and triggers the handshake.

### 2.3 Delivery — a locked token on the public mesh

To pay a peer:

1. Read their x-only Nostr key from their `:nut` favorite.
2. Mint/swap a Cashu token **P2PK-locked (NUT-11, single-sig)** to `02` + that
   key.
3. Broadcast it as a single **public** bitchat message (the normal fragmented
   public-mesh path — *not* a private DM).

A P2PK-locked token is safe to broadcast in the clear. **Bearer (unlocked)
sends** to peers with no `:nut` identity use the same public path behind an
explicit "anyone nearby can claim this" consent.

### 2.4 Receiver classification

Classify **every** inbound public cashu token against your own key:

| Classification | Condition | Action |
| --- | --- | --- |
| **locked-to-me** | every proof is single-sig P2PK to *my* key | redeem (auto; untrusted mint → park, never auto-swap) |
| **locked-to-other** | any proof locked to a different key / multisig / mixed | **ignore** (also drops your own broadcast echo) |
| **bearer** | no P2PK locks | leave to the chat surface's manual tap-to-redeem |

Delivery is best-effort over the mesh; there is no status reply.

## 3. Do you have to modify bitchat?

| Capability | Unmodified bitchat | What it needs |
| --- | --- | --- |
| Discover Sovran on the mesh | ✅ (same mainnet UUID) | — |
| See our broadcast token as a cashu chip | ✅ (stock renders `cashu…`) | — |
| Redeem a **bearer** token we broadcast | ✅ (manual tap) | — |
| Advertise a lockable identity to us | ❌ (never sends `:nut`) | send `[FAVORITED]:npub:nut` (§2.1) |
| **Redeem a token we locked _to them_** | ❌ (no P2PK redeem path) | a Cashu wallet + the `:nut` favorite |
| Send us a locked token | ❌ (no compose path) | learn our `:nut` key + lock + broadcast (§2.3) |

**Bottom line:** stock bitchat is a *passive* participant — it can see and grab
bearer tokens, nothing more. To become a *full* peer a client needs exactly
three things, **none of which require a bitchat protocol change** (they all ride
native mechanisms):

1. **Emit** `[FAVORITED]:npub:nut` to peers (and eagerly, to be discoverable).
2. **Parse** inbound `:nut` favorites → record peer→npub; treat a bare favorite
   as not-lockable.
3. **Classify + redeem** inbound public cashu tokens, and **compose** locked
   tokens to peers' keys + broadcast.

### 3.1 What Sovran patches in the vendored bitchat (and what it does NOT)

Because the identity exchange reuses native mechanisms, Sovran's `bitchat`
fork carries **no ecash-specific wire patch** — the favorite send/receive is
done in Sovran-owned bridge code (`BitChatBLEBridge.swift` / `.kt`) calling the
public `sendPrivateMessage`. The remaining vendor patches are build/privacy
only: import fix-ups, the mainnet-UUID forcing, a neighbor-gossip privacy
suppression, a `linkState` de-privatize, and (iOS) a temporary relaxation of an
announce sender-mismatch check for older App Store builds. There is **no**
announce-TLV patch and **no** signing-canonicalization patch.

## 4. Why this is "the bitchat way"

The design goal is to touch the bitchat protocol **not at all**:

- No new announce TLV, no new packet type, no new Noise payload type, no
  protocol-version bump.
- Identity travels on the favorite notification bitchat already ships; ecash
  travels on the public mesh bitchat already fragments.
- Vanilla clients are unaffected: they parse the npub from our favorite and
  ignore `:nut`, and they render our broadcast token as a normal (unredeemable)
  chip.

The trade for this purity is that discovery is **active** (you favorite peers;
stock users see "favorited you") and **relationship-gated** (you only hold keys
for peers you've exchanged favorites with) — there is no passive lockable-on-
sight, because bitchat deliberately keeps Nostr keys out of the announce.

## 5. Why public mesh and not private DMs — the 255-byte wall

bitchat private messages carry content in a TLV with a **one-byte length** — a
hard **255-byte cap**. A P2PK-locked Cashu token (proofs + NUT-11 witness +
locked secret per proof) is comfortably over 255 bytes, so it **does not fit** a
DM. The public mesh path is already transparently fragmented and — because the
token is P2PK-locked — safe in the open. (See bitchat #784 for the stalled
effort to lift the 255-byte cap; until it lands, locked ecash over a private
channel isn't possible, which is why nearby ecash rides the public mesh.)

## 6. Reference implementation

Sovran (this repo): the favorite send/receive + `:nut` capability gate in
`modules/bitchat-module/ios/BitChatBLEBridge.swift` and
`android/src/main/java/expo/modules/bitchat/BitChatBLEBridge.kt`; the JS surface
(`sendBLEFavorite`, `onBLEPeerIdentity`, `BLEPeer.nostrPubkeyHex`) in
`modules/bitchat-module/src/`; eager discovery in
`features/nearPay/hooks/useEagerPeerFavorite.ts`; lock-key derivation
(`02` + `nostrPubkeyHex`) + bearer-consent in the NearPay screens; token
classification + auto-redeem in `@sovranbitcoin/colada` `src/transport/`.
