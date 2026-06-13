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
- we (Sovran) ship a single announce TLV at `0xF0` (details below) — and
  nothing on the Noise payload seam.

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

## What we ship through this seam (concrete example)

A single ecash capability beacon on the announce — full note in
[`nut18-bitchat-transport.md`](./nut18-bitchat-transport.md):

```
announce TLV 0xF0, len 39:  "NUTB" | version 0x03 | flags | p2pk (33)
  flags bit0/bit1 = informational (answers cashu requests / auto-redeems)
  p2pk            = 33-byte "02"-prefixed secp256k1 key (the peer's P2PK
                    lock target == "02" + its x-only Nostr pubkey)
```

The exchange itself uses **no new packet types**: the sender locks a cashu
token to the announced key and broadcasts it on the existing public mesh; a
P2PK-locked token is safe in the open because only the recipient can redeem
it. Receivers classify inbound public cashu tokens against their own key.

Properties worth noting:

- the TLV is appended **before** the announce is signed, so the Ed25519
  signature covers it and unmodified clients verify normally;
- per-announce authoritative (a verified announce without the TLV clears
  the peer's recorded capability) — same semantics as the `0x04` TLV;
- the only on-air addition is this one announce TLV — we touch neither the
  Noise payload seam nor the packet model;
- vanilla clients are completely unaffected (the `0xF0` TLV is skipped, and
  a locked `cashu…` token on the public mesh renders as a normal token chip
  they simply can't redeem).

This is complementary to #1053 (which moves payment payloads into Noise with
a new packet model): here the same outcome falls out of a standard NUT-11
P2PK lock on the existing public mesh, with no protocol-version bump and no
255-byte DM-cap concern (locked tokens ride the public, already-fragmented
path rather than a private DM).

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
crosses it. Our 41-byte `0xF0` beacon TLV crosses it on every announce, so
this fix is a hard prerequisite for the capability beacon to be visible
cross-platform at all. Android's announce handler requires a verified signature
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
Cashu over bitchat, but as small as it goes. Every announce carries one
vendor TLV (`0xF0`, 39 B) holding the peer's 33-byte P2PK key — which is
just `02` + their Nostr pubkey, so it doubles as their identity. To pay a
nearby peer you lock a token (NUT-11) to that announced key and broadcast it
on the existing public mesh; a locked token is safe in the open because only
they can redeem it, and everyone else (including your own echo) just ignores
it. Receivers auto-redeem anything locked to their key; untrusted mints get
parked, never auto-swapped. No solicit, no payment-request round-trip, no new
Noise payload types — the only on-air change is that one announce TLV, which
stock clients skip. (We did need one upstream-shaped fix: signing over the
*uncompressed* packet form, since deflate isn't canonical cross-platform and
the TLV pushes the announce past the 100 B compress threshold — write-up in
the issue draft.) Shipping in Sovran on iOS + Android now. Note:
`nut18-bitchat-transport.md`. Would love your read on whether announcing a
static P2PK key (the identity↔lock-target unification, and its passive
correlation trade-off) matches how you'd want wallets to do nearby cashu.
