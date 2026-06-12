# Upstream issue draft — permissionlesstech/bitchat

> Paste-ready GitHub issue. Local draft only — review, edit, and post it
> yourself. Nothing in this repo posts anything upstream.

---

**Title:** Proposal: documented vendor ranges for announce TLVs and Noise payload types

## Context

Both extension seams in the protocol are already tolerant by design:

- **Announce TLVs**: unknown types are skipped (`Packets.swift` /
  `IdentityAnnouncement.kt`, "tolerant decoder for forward compatibility",
  covered by `announcementPacketRoundTripsNeighborsAndSkipsUnknownTLVs`).
- **Noise payload types**: unknown first bytes after decryption are dropped
  silently on both platforms — Android upstream itself used this seam to
  add file transfer (`0x20`+) without an iOS counterpart breaking.

The ecosystem is already extending through both seams without coordination:

- upstream added announce TLV `0x04` (direct neighbors) for source routing;
- at least one fork (bitpoints.me) shipped its own TLV at… also `0x04`,
  colliding with upstream's later allocation;
- #1053 informally squats Noise payload types `0x20`/`0x21` for
  Lightning/Cashu packets while Android file transfer already uses `0x20`+;
- we (Sovran) ship an announce TLV at `0xF0` and Noise payload types
  `0xA0`–`0xA3` (details below).

More extensions are coming (#1073 anticipates third-party SDKs). Without
guidance, collisions like the `0x04` one will repeat silently — a collision
means one client misreads another's bytes as its own structure.

## Proposal — reserve vendor ranges (documentation only)

Document in the protocol docs (WHITEPAPER / SOURCE_ROUTING style):

1. Announce TLV types `0x01`–`0xEF` and Noise payload types `0x01`–`0x9F`
   are reserved for the core protocol, allocated by upstream.
2. Announce TLVs `0xF0`–`0xFE` and Noise payload types `0xA0`–`0xEF` are
   open for vendor/application extensions.
3. A vendor announce TLV's value MUST begin with a short fixed ASCII magic
   (4–8 bytes), so two vendors landing on the same type fail closed on the
   magic check instead of misparsing each other. (Noise payloads need no
   magic — they only flow between peers that negotiated the capability,
   e.g. via an announce TLV.)
4. Decoders MUST keep skipping unknown TLVs / dropping unknown payload
   types (already true) and SHOULD ignore trailing bytes beyond an
   extension's documented length, so extensions can append fields without
   version dances.

This costs upstream nothing in code — it documents behavior the decoders
already have.

## What we ship through these seams (concrete example)

A 6-byte ecash capability beacon and an in-band Cashu payment exchange —
full spec in [`nut18-bitchat-transport.md`](./nut18-bitchat-transport.md)
(being proposed to cashubtc/nuts as a NUT-18 transport definition):

```
announce TLV 0xF0, len 6:  "NUTB" | version 0x02 | flags
  bit0 = answers cashu payment-request solicits over Noise
  bit1 = auto-redeems received ecash

Noise payloads (between capable peers only):
  0xA0 solicit a payment request   0xA1 the request ("creq…")
  0xA2 the payment (NUT-18 JSON)   0xA3 received/redeemed/rejected
```

Properties worth noting:

- the TLV is appended **before** the announce is signed, so the Ed25519
  signature covers it and unmodified clients verify normally;
- per-announce authoritative (a verified announce without the TLV clears
  the peer's recorded capability) — same semantics as the `0x04` TLV;
- no key material on the air: the receiver's lock key and trusted mints
  travel per-exchange inside a standard NUT-18 payment request, so locked
  payments are only ever made against a request the receiver just issued;
- vanilla clients are completely unaffected on both seams.

This is complementary to #1053 (which moves payment payloads into Noise
with a new packet model): the same outcome falls out of existing NUT-18
artifacts over the existing typed-payload seam, with no protocol-version
bump. And it sidesteps #784's 255-byte private-message cap — the payloads
ride `noiseEncrypted` packets, which the transport already fragments.

## Ask

1. Would you take a docs PR reserving the two vendor ranges above?
2. If upstream would rather absorb the concrete use case into the protocol
   docs as an optional extension, we're happy to adapt our allocation
   (type bytes, magic, layout) to whatever upstream prefers — nothing is
   frozen on our side, and both ends of the exchange are ours.

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

---

# Calle brief (off-GitHub outreach)

> Short message for Calle (Cashu author, bitchat collaborator — the
> designated reviewer for cashu-adjacent bitchat work, who asked the
> bitpoints author to take exactly this conversation to DMs). Telegram /
> X / Nostr; trim to taste.

Hey — we built what #784 / bitchat-android#506 / #1053 have been circling:
Cashu over bitchat, but as a **NUT-18 transport** instead of a new
protocol. Receiver answers an in-band solicit with a real single-use
`creq` (fresh P2PK `nut10`, their trusted mints as `m`, empty transport =
in-band per spec); sender pays it as a normal PaymentRequestPayload over
the Noise session; received/redeemed statuses come back the same way. A
6-byte announce TLV is the only discovery surface — no keys on the air.
Stock clients are untouched (both platforms drop unknown Noise payload
types / announce TLVs by design), it clears the 255-byte DM cap via the
existing fragmentation, and it kills the untrusted-mint and blind-locking
footguns before any money moves. Shipping in Sovran on iOS + Android now.
Draft spec: `nut18-bitchat-transport.md` (happy to PR it to cashubtc/nuts
as a transport definition if you think it fits). Would love your read on
whether the wallet-side conventions (single-use, 120s expiry, sender-offline
bearer flag) match how you'd want wallets to do this.
