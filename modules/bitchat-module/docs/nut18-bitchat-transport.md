# Cashu over bitchat: capability beacon + public-mesh ecash

> Draft note for cashubtc/nuts + permissionlesstech/bitchat — a **minimal way
> to send P2PK-locked ecash between two nearby bitchat devices with no
> internet**. Local document only; nothing here is posted upstream
> automatically. The contribution is deliberately small: one vendor TLV on the
> announce, and the existing public mesh for delivery. No new packet types, no
> handshake.

Status: implemented (Sovran iOS + Android, vendor extension); seeking feedback
before a cashubtc/nuts note.

## Motivation

bitchat gives two phones an encrypted Bluetooth mesh with no internet. Cashu
gives them a bearer-token money format. Gluing them naively — pasting a
`cashuA…` token into a public chat message — works, but the token is a bearer
instrument readable (and claimable) by every peer in range.

P2PK-locking the token (NUT-11) fixes the theft problem: only the holder of the
target key can redeem it. The only thing the sender needs is the recipient's
key — and bitchat already broadcasts a per-peer identity in every announce. So:
**announce a P2PK key, lock to it, and broadcast the locked token on the public
mesh.** A locked token is safe in the open — everyone who isn't the recipient
just ignores it.

## Overview

```
 Receiver announces (always, in every signed announce):
   capability beacon TLV 0xF0 → "NUTB" v3 | flags | 33-byte P2PK key

 Sender (on tapping that peer):
   lock a cashu token to the announced key  →  broadcast it on the public mesh

 Every device on the mesh, on seeing a public cashu token:
   classify against my key →  locked-to-me   → redeem (auto)
                              locked-to-other → ignore (incl. my own echo)
                              bearer          → manual tap-to-redeem
```

That single announced key is the peer's whole identity: drop the `02` prefix
for the x-only Nostr pubkey (profile lookup), use the full 33 bytes as the P2PK
lock target. There is no solicit, no payment request, no status handshake — the
locked token rides bitchat's existing public-message path (transparently
fragmented; stock bitchat already renders a `cashu…` token as a redeemable
chip).

## Wire format

### Capability beacon (announce TLV `0xF0`)

Appended to the bitchat announce payload (a TLV stream; vanilla decoders skip
unknown types) **before signing**, so the Ed25519 announce signature covers it
and vanilla verification still passes.

```
type   = 0xF0
length = 39
value  = "NUTB" (4) | version 0x03 (1) | flags (1) | p2pk (33)
flags  : bit0 = answers cashu payment requests (legacy/informational)
         bit1 = auto-redeems received ecash (informational, drives UI)
         bits 2–7 reserved: 0 on send, ignored on receive
p2pk   : 33-byte compressed secp256k1 key, "02"-prefixed
         ("02" + the announcer's x-only Nostr pubkey, NUT-11 / Minibits
          convention — BIP340 signing ignores Y parity)
```

Golden vector (both flag bits, key `02aa…aa`):
`f0 27 4e 55 54 42 03 03` + `02` + `aa×32`

Decoders MUST ignore trailing value bytes (append-only evolution); an unknown
version (including the v2 flags-only beacon) means "treat the peer as vanilla".
`0xF0` sits in the vendor TLV range that upstream's tolerant announce decoder
already skips, so non-implementing clients are unaffected.

**Privacy note.** Announcing a static key is a cross-nickname correlator — a
passive observer in BLE range can link a device's announces over time. This is
an accepted trade-off: it makes the peer's identity, Nostr profile, and P2PK
lock target all derivable from one announced value, with no extra round-trip.

## Delivery

A locked token is delivered as a single **public** bitchat message (the
existing fragmented public-mesh path — not a private DM, which caps content at
255 bytes). Because the token is P2PK-locked, broadcasting it in the open is
safe: only the recipient's key can redeem it. Bearer (unlocked) sends to
non-implementing peers use the same public path behind an explicit "anyone
nearby can claim this" consent.

## Receiver rules

Classify every inbound public cashu token against your own P2PK key:

- **locked-to-me** — every proof is single-sig P2PK to my key → redeem (the
  wallet auto-trusts nothing: an untrusted mint parks the token for manual
  review, never an automatic swap).
- **locked-to-other** — any proof P2PK-locked to a different key, multisig, or
  a mixed token → ignore. This silently drops the sender's own broadcast echo.
- **bearer** — no P2PK locks → leave to the chat surface's manual
  tap-to-redeem.

There is no status reply: delivery is best-effort over the mesh, exactly like
any other public message.

## Relationship to existing work

- **permissionlesstech/bitchat #784 / #1327** — >255-byte private messages.
  Irrelevant here: locked tokens ride the *public* mesh (already fragmented),
  and a locked token is safe in the open.
- **bitchat-android #506 (bitpoints)** — same instinct (cashu over the mesh);
  this approach needs no bespoke payload format and no new packet model — just
  a vendor announce TLV and a P2PK-locked token on the existing public path.
- A companion note asks bitchat upstream to document a vendor range for announce
  TLVs (see `upstream-issue-draft.md`).

## Reference implementation

Sovran (this repo): the beacon constants + encoder and golden-vector test in
`modules/bitchat-module/src/nutDropProtocol.ts` and
`__tests__/nutDropProtocol.test.ts`; the native TLV encode/parse in
`EcashAnnounceExtension.swift`/`.kt`; token classification + auto-redeem in
`@sovranbitcoin/colada` `src/transport/` (`classifyMeshToken`,
`createMeshRedeemOrchestrator`).
