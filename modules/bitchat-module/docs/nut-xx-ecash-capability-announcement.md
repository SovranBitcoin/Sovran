# NUT-XX: Ecash Capability Announcement over Broadcast Transports

`optional`

`depends on: NUT-10, NUT-11`

---

> [!NOTE]
> **Review note (delete before submitting to cashubtc/nuts).**
> Why a new NUT instead of amending NUT-18: NUT-18 payment requests are
> per-request, receiver-generated `creq…` strings with embedded transports.
> This spec is the opposite lifecycle — a standing, broadcast capability
> beacon carried inside a transport's own discovery packets (40 bytes, binary,
> re-announced continuously). The two compose (a NUT-18 request can still ride
> over a mesh chat message); they don't substitute. Precedent for wallet-only
> NUTs with no mint involvement: NUT-16 (animated QR), NUT-18, NUT-26, NUT-27.
> Submission flow: PR titled "NUT-XX — Ecash Capability Announcement"; a
> number is assigned on merge (cf. PR #300 → NUT-28, PR #294 → NUT-26).

This document describes how a wallet announces — inside a broadcast
transport's discovery layer — that it can receive [NUT-11][11] P2PK-locked
ecash, and which key to lock to. It exists so that senders on mixed-client
networks never lock a token to a recipient that cannot redeem it: locking to
a key the recipient's wallet does not control (or cannot sign for) destroys
the funds for both parties, while sending an unlocked token exposes it to
anyone listening.

The capability advertisement is defined concretely for the
[bitchat](https://github.com/permissionlesstech/bitchat) BLE mesh announce
packet. The value layout (magic onward) is transport-agnostic and MAY be
reused verbatim in any other beacon-style transport that offers a tolerant
TLV stream.

## Motivation

Mesh/proximity transports already carry cashu tokens as plain text — bitchat
clients render a broadcast `cashu…` string as a redeemable token. But a
broadcast bearer token is claimable by whoever sees it first. [NUT-11][11]
P2PK locking fixes the race, only if the sender knows (a) that the recipient's
wallet implements NUT-11 receive, and (b) which pubkey to lock to. Neither is
discoverable today. This NUT makes both discoverable from the transport's
existing discovery traffic, with zero changes required from clients that do
not implement it.

## Capability TLV

bitchat announce payloads are a TLV stream whose decoders skip unknown TLV
types ("tolerant decoder", upstream iOS `Packets.swift` and Android
`IdentityAnnouncement.kt`). A wallet that can receive P2PK-locked cashu
appends one extra TLV to every announce:

| Field        | Size | Value                                              |
| ------------ | ---- | -------------------------------------------------- |
| TLV type     | 1    | `0xF0`                                             |
| TLV length   | 1    | `40` (decoders MUST accept `length >= 40`)         |
| Magic        | 5    | ASCII `"NUTXX"` (`0x4E 0x55 0x54 0x58 0x58`)       |
| Version      | 1    | `0x01`                                             |
| Flags        | 1    | capability bitmask (below)                         |
| P2PK pubkey  | 33   | compressed key: `0x02 \|\| <32-byte x-only key>`   |

The magic is a fixed identifier for this extension and does not change when a
NUT number is assigned; evolution is governed by the version byte. Fields are
fixed-offset for all versions: a parser that recognises the magic reads flags
and pubkey at the same offsets regardless of version, and MUST ignore any
trailing bytes beyond offset 40 (future versions append, never reorder).

### Flags

| Bit | Mask   | Meaning                                                       |
| --- | ------ | ------------------------------------------------------------- |
| 0   | `0x01` | Auto-redeem: the wallet redeems tokens locked to the announced key as soon as it sees them on the transport, without user interaction. |
| 1–7 | —      | Reserved. Senders MUST set to `0`; receivers MUST ignore.     |

### Semantics

The TLV's presence on a **verified** announce asserts: *this peer's wallet can
redeem cashu locked single-sig (NUT-11, `n_sigs = 1`) to the announced
pubkey.* In [NUT-10] terms it is a standing advertisement of the locking
condition `{"kind": "P2PK", "data": "02<x-only key>"}` (the same shape a
[NUT-18] `nut10` option would carry).

The announced key uses the `0x02`-parity compressed form of the wallet's
x-only signing key (BIP340 signing ignores Y parity — same convention as
Minibits and other NUT-11 wallets).

Announce TLVs are authoritative per-announce: a verified announce **without**
the TLV clears any previously recorded capability for that peer (this is how
upstream bitchat treats its own optional announce TLVs, e.g. `0x04`
direct-neighbors).

### Why type `0xF0`, and why a magic

Upstream bitchat allocates announce TLV types sequentially from `0x01`
(`0x01`–`0x04` as of early 2026), and at least one fork has already collided
inside that range (bitpoints.me at `0x04`). `0xF0` sits far above the
sequential allocation. The 5-byte magic disambiguates further: if another
vendor independently lands on `0xF0`, a parser rejects the value on the magic
check instead of misreading foreign bytes as a pubkey.

### Signing

The TLV is appended to the announce payload **before** the announce is
Ed25519-signed, exactly where upstream appends its own optional TLVs. The
announce signature therefore covers the capability and the lock key, and
unmodified bitchat clients verify such announces successfully (verified
against upstream's `announcementPacketRoundTripsNeighborsAndSkipsUnknownTLVs`
test).

Implementations MUST record the capability only from announces whose
signature verified. The capability is a *feature gate, not a trust signal*:
any client can claim it, and the worst a false claim achieves is receiving a
token locked to the claimed key.

## Sender rules

1. Lock a token (NUT-11 single-sig) to a peer's announced key **only** when
   the capability TLV was present on that peer's latest verified announce.
2. Without the capability, a sender MAY fall back to an unlocked bearer
   token, but MUST obtain explicit user consent first, making clear that a
   broadcast bearer token is claimable by anyone on the transport.
3. The lock target MUST be byte-exact the announced key. Senders SHOULD
   verify the completed send's lock against the announced key immediately
   before broadcast and abort delivery on any mismatch (the token then stays
   in local history instead of reaching the transport).

## Receiver rules

A receiving wallet classifies each token seen on the transport against its
own announced key:

- **locked-to-me** — every proof single-sig P2PK-locked to my key: redeem
  (automatically iff announcing flag bit 0). Multisig or mixed tokens are
  treated as locked-to-other; partial redemption of a mixed token would
  strand the remainder.
- **locked-to-other** — render as an ordinary (unredeemable) message.
- **bearer** — unlocked: render as a manually redeemable token, never
  auto-redeem (auto-redeeming bearer broadcasts would race every other
  listener and turn the wallet into a vacuum for misdirected sends).
- **invalid** — ignore.

Receivers SHOULD dedupe by token hash: mesh transports re-deliver, and the
sender's own broadcast echoes back. Note the asymmetry: a locked drop's echo
is inert for everyone but the recipient, while a **bearer** drop's echo is
redeemable by the *sender's own wallet* too — a tap on the echoed bubble
reclaims the funds, which acts as a de-facto undo and should be left manual.

## Delivery payload

The token itself travels as an ordinary public broadcast message containing
the [NUT-00] serialized token (`cashu…`) as its entire content, in a single
message (bitchat's public path fragments and reassembles transparently;
unmodified clients already render it as a redeemable token). Private/DM paths
are NOT used: bitchat private messages cap content at 255 bytes, below
typical token sizes.

## Security considerations

- **Capability spoofing**: signed announces bind the claim to the announcing
  identity, but any client may claim the capability. Senders lose nothing to
  a spoofed claim beyond what the spoofer could redeem — which is the point
  of the lock.
- **Bearer fallback**: inherently claimable by anyone; hence the mandatory
  explicit consent in sender rule 2.
- **Broadcast visibility**: locked drops reveal amount, mint, and recipient
  key to all listeners. Treat the transport as public.
- **State growth**: receivers SHOULD bound the per-peer capability registry
  (announce-rate policing upstream already bounds inflow; a fixed cap, e.g.
  256 peers, backstops a hostile mesh).

## Test vector

Announce TLV for flags `0x01` (auto-redeem) and x-only key `ab…ab` (32
bytes):

```
f0 28 4e55545858 01 01 02abababababababababababababababababababababababababababababababab
```

- `f0` — TLV type
- `28` — length 40
- `4e55545858` — "NUTXX"
- `01` — version 1
- `01` — flags: auto-redeem
- `02ab…ab` — compressed P2PK pubkey (33 bytes)

Full TLV: 42 bytes. Decoders MUST also accept `length > 40` for this type,
ignoring bytes past the pubkey.

[NUT-00]: https://github.com/cashubtc/nuts/blob/main/00.md
[NUT-10]: https://github.com/cashubtc/nuts/blob/main/10.md
[11]: https://github.com/cashubtc/nuts/blob/main/11.md
[NUT-11]: https://github.com/cashubtc/nuts/blob/main/11.md
[NUT-18]: https://github.com/cashubtc/nuts/blob/main/18.md
