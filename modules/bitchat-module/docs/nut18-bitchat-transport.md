# Cashu over bitchat: native identity+mint exchange + private-DM ecash

> Draft note for cashubtc/nuts + permissionlesstech/bitchat — a **minimal way to
> send ecash between two nearby bitchat devices with no internet**. Local
> document only; nothing here is posted upstream automatically. The contribution
> is deliberately **near-zero new wire format**: identity + accepted-mint
> advertisement ride bitchat's existing favorite notification (carrying a
> standard NUT-18 `creq`), and the token rides a private Noise DM. The single
> wire change is a backward-compatible widening of our own private-message
> content length. No announce TLV, no new packet type, no new Noise payload type.

Status: implemented (Sovran iOS + Android); seeking feedback before a
cashubtc/nuts note. Interop contract: [`cashu-bitchat-compatibility.md`](./cashu-bitchat-compatibility.md).

## Motivation

bitchat gives two phones an encrypted Bluetooth mesh with no internet. Cashu
gives them a bearer-token money format. We want to hand a token to a *specific*
nearby peer, privately, and never lock it to a mint the peer can't redeem at. The
sender needs two things from the recipient — its key (to optionally P2PK-lock)
and its accepted mints — and bitchat already has a native channel to carry both.

## The key insight

bitchat's **Nostr identity** is a secp256k1 Schnorr x-only key — exactly a
NUT-11 P2PK target. And bitchat already shares it over the mesh: the **favorite
notification** (`[FAVORITED]:npub`, a Noise-encrypted private message) is its one
native channel for handing a peer your Nostr identity. We append a standard
**NUT-18 payment request** (`creq`) to that favorite so the same message also
advertises the sender's **accepted mints** and its **P2PK lock key** — then
deliver the token as a private Noise DM.

## Overview

```
 Discovery (eager, while the nearby-pay radar is open):
   favorite each peer  →  "[FAVORITED]:<my npub>:<my creq>"
     creq = NUT-18 standing request: accepted mints + nut10 P2PK to "02"+npub
   a Sovran peer reciprocates → both hold each other's key + accepted mints

 Pay a peer you hold a creq for:
   online + shared mint → P2PK-lock (NUT-11) to "02"+key from a shared mint
   offline / no creq    → bearer
   no shared mint       → block (clear message)
   deliver: the whole token as ONE private Noise DM to that peer

 Receiver, on a token DM addressed to it:
   locked-to-me → redeem (auto)
   bearer       → redeem (the DM is addressed to me)
   locked-to-other → ignore
```

That one x-only key is the peer's whole identity: the kind-0 profile key, and
`02`-prefixed, the P2PK lock target. The creq adds the accepted-mint list the key
alone can't carry.

## The creq capability + mint signal

A *stock* bitchat user who favorites you sends a bare `[FAVORITED]:npub` and can't
redeem P2PK ecash — locking to them would strand funds. More subtly, even a
cashu-capable peer can't redeem a token minted at a mint it doesn't trust. So
Sovran appends a NUT-18 `creq` (accepted mints + `nut10` P2PK to `02`+npub) and
treats a peer as **lockable only when its favorite carries a valid creq** whose
lock key matches its npub. The sender then locks **only to a shared mint**, or
blocks the send when there's no overlap — never producing an unredeemable token.
This is the [numo](https://github.com/cashubtc/numo) mint-advertisement pattern,
extended with a standing request + P2PK lock; coco doesn't build standing requests
yet, so we use `@cashu/cashu-ts` directly. The creq is URL-safe base64 (no `:`),
so it rides cleanly inside `[FAVORITED]:<npub>:<creq>`.

## Delivery — a private DM, not the public mesh

The whole token is one **private Noise DM** to the peer — encrypted to them, so
locked *or* bearer the payment stays private. The 255-byte private-message cap was
a *message-format* limit (`PrivateMessagePacket.encode()` `return nil`ed above
255), not a radio one — the transport already fragments oversized encrypted
packets. We widen our own content-length field backward-compatibly: `0x00–0xFE` is
a literal 1-byte length (byte-identical to stock), `0xFF` is a sentinel + 2-byte
big-endian length (≤64 KB). ≤254 B is exactly stock on the wire; only our clients
decode a larger message — which is fine, since payments are Sovran↔Sovran.

## Receiver rules

Classify every inbound token DM against your own key: **locked-to-me** →
auto-redeem (untrusted mint parks, never auto-swaps); **bearer** → auto-redeem
(the DM is addressed to me); **locked-to-other / multisig / mixed** → ignore.
Pure-token DMs are kept out of the chat thread. No status reply — best-effort.

## Relationship to existing work

- **bitchat #784 / #1327** (>255-byte private messages) — we widen the length only
  for our own clients (≤254 B stays byte-identical to stock), so we don't depend on
  an upstream protocol-wide change landing.
- **bitchat #1053** (Lightning/Cashu Noise payload types `0x20`/`0x21`) — a heavier
  path that adds a new packet model + new payload types (and `0x20` collides with
  Android's `FILE_TRANSFER`). Our approach needs none of it: a private DM over the
  existing Noise channel, with only a wider length field.
- **bitchat-android #506** (bitpoints 2-byte-TLV cashu DM) — the same idea as our
  extended length, arrived at independently.

## Trade-offs

- **Sovran↔Sovran.** A stock client decodes neither our creq favorite nor our
  extended token DM, and has no P2PK redeem path. This is the cost of a private,
  mint-correct transfer with near-zero new wire format.
- **Active, relationship-gated discovery.** bitchat keeps Nostr keys out of the
  announce, so there's no passive lockable-on-sight. You favorite peers and only
  hold keys for peers you've exchanged favorites with.
- **Pairwise Noise sessions.** Both the creq favorite and the token DM need a
  Noise session per peer — heavier than a broadcast, but uses only mechanisms
  bitchat already ships (plus the eager-favorite handshake tie-breaker).

## Reference implementation

creq build/parse + capability gate: `shared/lib/nutCreq.ts`. Send decision:
`features/nearPay/lib/nearPaySendDecision.ts`. Favorite send/receive (npub +
creq) + extended length: `BitChatBLEBridge.swift` / `.kt` and the
`scripts/patch-bitchat-imports.js` / `scripts/sync-bitchat-android.js` patches.
Whole-token DM: `features/bitchat/lib/blePrivateDelivery.ts`. JS surface
(`BLEPeer.nostrPubkeyHex` + `BLEPeer.creq`, `onBLEPeerIdentity`):
`modules/bitchat-module/src/`. Receive/redeem (locked-to-me OR bearer) +
chat suppression: `features/nearPay/hooks/useNutDropAutoRedeem.ts` and
`shared/providers/BitchatBLEProvider.tsx`. Classification + mint selection:
`@sovranbitcoin/colada`.
