# Cashu over bitchat: native identity exchange + public-mesh ecash

> Draft note for cashubtc/nuts + permissionlesstech/bitchat — a **minimal way to
> send P2PK-locked ecash between two nearby bitchat devices with no internet**.
> Local document only; nothing here is posted upstream automatically. The
> contribution is deliberately **zero new wire format**: identity rides
> bitchat's existing favorite notification, ecash rides the existing public
> mesh. No announce TLV, no new packet type, no Noise payload type, no handshake
> beyond bitchat's own favorite exchange.

Status: implemented (Sovran iOS + Android); seeking feedback before a
cashubtc/nuts note. Interop contract: [`cashu-bitchat-compatibility.md`](./cashu-bitchat-compatibility.md).

## Motivation

bitchat gives two phones an encrypted Bluetooth mesh with no internet. Cashu
gives them a bearer-token money format. Pasting a `cashuA…` token into a public
message works, but a bearer token is claimable by every peer in range. P2PK
(NUT-11) fixes that: lock the token to the recipient's key and only they can
redeem it. The only thing the sender needs is the recipient's key — and bitchat
already has a native way to share one.

## The key insight

bitchat's **Nostr identity** is a secp256k1 Schnorr x-only key — exactly a
NUT-11 P2PK target. And bitchat already shares it over the mesh: the
**favorite notification** (`[FAVORITED]:npub`, a Noise-encrypted private
message) is its one native channel for handing a peer your Nostr identity. So we
don't invent a transport — we reuse the favorite exchange to learn the key, then
lock to it and broadcast on the public mesh.

## Overview

```
 Discovery (eager, while the nearby-pay radar is open):
   favorite each peer  →  "[FAVORITED]:<my npub>:nut"   (native favorite + a
                                                          ":nut" capability tag)
   a Sovran peer reciprocates → both now hold each other's x-only key

 Pay a peer you hold a :nut key for:
   lock a cashu token to "02"+key (NUT-11)  →  broadcast on the public mesh

 Every device, on a public cashu token:
   locked-to-me   → redeem (auto)
   locked-to-other→ ignore (incl. my own echo)
   bearer         → manual tap-to-redeem
```

That one x-only key is the peer's whole identity: the kind-0 profile key, and
`02`-prefixed, the P2PK lock target.

## The `:nut` capability marker

A *stock* bitchat user who favorites you sends a bare `[FAVORITED]:npub` carrying
their bitchat identity — but they can't redeem P2PK ecash. Locking to them would
strand the funds. So Sovran appends `:nut` to its own favorites and treats a peer
as **lockable only when its favorite carries `:nut`**. The marker goes **after**
the npub so both stock parsers (iOS `split(":")[1]`, Android `substringAfter(":")`)
still recover a usable npub and ignore — or harmlessly store — the suffix.

## Delivery

A locked token is one **public** bitchat message (the existing fragmented
public-mesh path — not a 255-byte-capped private DM). Locked, it's safe in the
open. Bearer sends to non-`:nut` peers use the same path behind explicit consent.

## Receiver rules

Classify every inbound public cashu token against your own key:
**locked-to-me** → auto-redeem (untrusted mint parks, never auto-swaps);
**locked-to-other / multisig / mixed** → ignore (drops your own echo);
**bearer** → manual tap-to-redeem. No status reply — best-effort, like any
public message.

## Relationship to existing work

- **bitchat #784 / #1327** (>255-byte private messages) — irrelevant here:
  locked tokens ride the *public* mesh, and a locked token is safe in the open.
- **bitchat #1053** (Lightning/Cashu Noise payload types `0x20`/`0x21`) — a
  heavier path that adds a new packet model and *bearer* tokens over the Noise
  seam (and `0x20` collides with Android's `FILE_TRANSFER`). Our approach needs
  none of it: NUT-11 P2PK on the existing public mesh, identity on the existing
  favorite channel.
- **bitchat-android #506** (bitpoints) — same instinct; this needs no bespoke
  payload format and no new packet type.

## Trade-offs

- **Active, relationship-gated discovery.** bitchat keeps Nostr keys out of the
  announce, so there's no passive lockable-on-sight. You favorite peers (stock
  users see "favorited you") and only hold keys for peers you've exchanged
  favorites with. This is the cost of touching the protocol *not at all*.
- **Pairwise Noise sessions.** Learning a key requires the favorite DM, hence a
  Noise session per peer — heavier than a one-shot broadcast, but uses only
  mechanisms bitchat already ships.

## Reference implementation

Favorite send/receive + `:nut` gate: `BitChatBLEBridge.swift` / `.kt`. JS
surface (`sendBLEFavorite`, `onBLEPeerIdentity`, `BLEPeer.nostrPubkeyHex`):
`modules/bitchat-module/src/`. Eager discovery:
`features/nearPay/hooks/useEagerPeerFavorite.ts`. Classification + auto-redeem:
`@sovranbitcoin/colada` `src/transport/`.
