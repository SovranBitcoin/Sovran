# Upstream issue draft — permissionlesstech/bitchat

> Paste-ready GitHub issue. Local draft only — review, edit, and post it
> yourself. Nothing in this repo posts anything upstream.

---

**Title:** Proposal: reserved announce-TLV range for vendor extensions (and/or a standard ecash-capability TLV)

## Context

The announce payload decoders on both platforms are deliberately tolerant —
unknown TLV types are skipped (`Packets.swift` / `IdentityAnnouncement.kt`,
"tolerant decoder for forward compatibility", covered by
`announcementPacketRoundTripsNeighborsAndSkipsUnknownTLVs`). That makes
announce TLVs a clean, vanilla-compatible extension point, and the ecosystem
is already using it that way:

- upstream itself added `0x04` (direct neighbors) for source routing;
- at least one fork (bitpoints.me) shipped its own TLV at… also `0x04`,
  colliding with upstream's later allocation;
- we (Sovran) ship a capability TLV at `0xF0` (details below).

Meanwhile #1053 (Lightning/Cashu payment payloads over Noise, types
0x20/0x21) shows payments are an active direction for the protocol, and
#1073 (protocol SDKs) anticipates more third-party implementations. More
extensions are coming; today there is no guidance on how they should claim
TLV space, so collisions like the `0x04` one will repeat silently — a TLV
collision in announce parsing means one client misreads another's bytes as
its own structure.

## Proposal A — reserve a vendor extension range

Document in the protocol docs (WHITEPAPER / SOURCE_ROUTING style):

1. Announce TLV types `0x01`–`0xEF` are reserved for the core protocol,
   allocated sequentially by upstream.
2. Types `0xF0`–`0xFE` are open for vendor/application extensions.
3. A vendor extension's value MUST begin with a short fixed ASCII magic
   (4–8 bytes) identifying the extension, so two vendors landing on the same
   type fail closed on the magic check instead of misparsing each other.
4. Decoders MUST continue to skip unknown TLVs (already true) and SHOULD
   ignore trailing bytes beyond an extension's documented length, so
   extensions can append fields without version dances.

This costs upstream nothing in code — it's pure documentation of the
behavior the decoders already have.

## Proposal B — standardize an ecash-capability TLV

If upstream would rather absorb the concrete use case: we ship a TLV that
advertises "this peer's wallet can receive P2PK-locked cashu, locked to this
key". It exists because broadcasting a bearer `cashu…` token (which stock
bitchat already renders as redeemable) is claimable by anyone in range, and
locking (Cashu NUT-11) is only safe if the sender knows the recipient can
redeem the lock — otherwise the funds are destroyed for both sides.

Wire format (full spec + test vector in our repo, happy to PR it as a doc):

```
type  = 0xF0
len   = 40            (decoders accept len >= 40)
value = "NUTXX" (5) | version 0x01 (1) | flags (1)
        | compressed P2PK pubkey (33 = 0x02 || x-only key)

flags bit0 = auto-redeems tokens locked to the announced key
```

Properties worth noting:

- appended **before** the announce is signed, so the Ed25519 signature
  covers it and unmodified clients verify the announce normally;
- per-announce authoritative (a verified announce without the TLV clears the
  peer's recorded capability) — same semantics as the `0x04` neighbors TLV;
- vanilla clients are unaffected: they skip the TLV and still render
  broadcast tokens as today. Clients implementing it stop sending bearer
  tokens to peers that can receive locked ones.

This is complementary to #1053: #1053 moves payment payloads into the Noise
channel between two upgraded clients; this TLV solves discovery — knowing
*before sending* that the peer can receive a locked payment at all, over the
existing public path that works with unmodified receivers.

## Ask

1. Would you take a docs PR reserving `0xF0`–`0xFE` for vendor extensions
   with the magic-prefix convention (Proposal A)?
2. Any interest in the ecash-capability TLV as a documented optional
   extension (Proposal B)? We're happy to adapt our allocation (type byte,
   magic, layout) to whatever upstream prefers — nothing is frozen on our
   side.

## Separate finding: packet signatures are not verifiable cross-platform once payloads compress

While testing the TLV above we hit what looks like a latent protocol bug
worth its own issue (happy to file separately if preferred):

`toBinaryDataForSigning()` — identical on iOS
(`BitFoundation/BitchatPacket.swift`) and Android
(`protocol/BinaryProtocol.kt`) — serializes the packet through
`BinaryProtocol.encode(...)`, which **compresses payloads ≥ 100 bytes**
before signing. The verifier re-encodes the decoded packet through *its
own* `encode(...)` to reconstruct the signed bytes. Raw-deflate output is
not canonical across implementations (Apple `COMPRESSION_ZLIB` and
`java.util.zip.Deflater` emit different bytes for identical input), so any
signed packet whose payload crosses the threshold verifies on the sender's
platform and **fails on the other one**.

Announces sit just under the threshold today (~76 B for nickname + the two
key TLVs), which is why this doesn't bite stock clients — but an announce
with a populated `0x04` neighbors TLV (3+ neighbors) or any vendor TLV
crosses it. Android's announce handler requires a verified signature
("no backward compatibility"), so an affected iOS announce is silently
dropped on Android while the reverse direction appears to work (iOS
tolerates unverified announces), producing confusing one-way visibility.

Suggested fix: make the signing form compression-independent — e.g.
`toBinaryDataForSigning()` encodes with compression disabled on both
platforms. Wire format stays unchanged (transmitted packets still
compress); only the signature input becomes canonical. We're running this
patch in our fork and can PR it if there's interest.
