# Cashu over bitchat (Sovran) — how it works

This explains how Sovran sends **P2PK-locked Cashu ecash to a nearby bitchat
peer, fully offline**, by reusing bitchat's own mechanisms — no protocol fork,
no new wire format. It's self-contained: read it top to bottom.

## The whole thing in four steps

1. **Learn identity** — a peer's Nostr public key arrives in bitchat's native
   favorite notification: `[FAVORITED]:<npub>:nut` (a Noise-encrypted private
   message). The peer's Nostr key *is* its identity.
2. **Lock** — P2PK-lock (Cashu NUT-11) a token to `02` + that x-only key.
3. **Deliver** — broadcast the locked token as an ordinary **public** mesh
   message (bitchat already fragments these, and stock clients already render a
   `cashu…` string as a redeemable chip).
4. **Redeem** — the receiver auto-redeems any token locked to its key; everyone
   else (including the sender's own echo) ignores it.

The peer's x-only Nostr key is one value used three ways: kind-0 profile lookup,
identity, and (02-prefixed) the P2PK lock target.

## Why P2PK + a public broadcast, instead of a simple private DM

The obvious design is: just DM a bearer Cashu token straight to the recipient —
private, simple, no P2PK needed. **We can't, and the whole design falls out of
why not:**

1. **A token doesn't fit a private DM — and that's a *message-format* limit, not
   a radio one.** bitchat's transport happily fragments oversized packets across
   BLE links (including Noise-encrypted ones), so the BLE MTU is a non-issue. The
   real cap is one layer up: `PrivateMessagePacket.encode()` puts the message
   `content` in a TLV with a **single-byte length field** and literally
   `return nil`s above 255 bytes. A Cashu token (proofs + secrets, plus per-proof
   witnesses once locked) is comfortably over 255 B for any real amount, so it
   can't even be *encoded* into a private message — and since fragmentation runs
   on an already-encoded packet, it can't help. The only fixes are to widen that
   length field (#784 — protocol-breaking, stalled) or to carry the token in a
   *custom* Noise payload type outside the standard private-message format
   (#1053's path, which `sendEncrypted` would then auto-fragment) — both
   non-standard, both avoided here.
2. **So we must use the public mesh.** It's the only channel with no length
   limit (messages are transparently fragmented). But a public message is
   visible to *every* peer in range — a **bearer** token broadcast in the open
   would be grabbed by whoever sees it first.
3. **So the token must be P2PK-locked before it's broadcast.** A NUT-11
   P2PK-locked token is safe in the open: only the holder of the target key can
   redeem it; everyone else just sees an inert chip. That turns "broadcast money
   to the room" into "broadcast money only its owner can pick up."
4. **P2PK needs the recipient's key up front** — which is why we exchange Nostr
   identities first (next section).

In short: the **255-byte DM cap** forces us onto the **public mesh**, and the
public mesh forces us to **P2PK-lock** — the design is a consequence of those two
constraints, not a preference. A non-P2PK private DM would be simpler, but it is
impossible under today's bitchat without lifting the 255-byte cap.

## How identity is exchanged

bitchat puts **no** Nostr key in its announce, so there's no passive way to learn
a peer's key. Its one native mesh channel for sharing a Nostr identity is the
**favorite notification**: when A favorites B, A sends B a Noise-encrypted
private message `[FAVORITED]:<A's npub>`, and B records `A → npub`. Sovran rides
this unchanged, plus a `:nut` capability marker:

- **Eager exchange** — while the nearby-pay radar is open, Sovran favorites every
  peer it discovers (`[FAVORITED]:<our npub>:nut`); a Sovran peer reciprocates and
  both become lockable-on-sight, a stock peer just sees a normal "favorited you".
- **The `:nut` marker is a fund-safety gate.** **Never P2PK-lock ecash to a peer
  unless you have positive proof it runs a cashu-aware wallet that can redeem
  it.** A bare `[FAVORITED]:npub` comes from a plain bitchat user — locking to
  their key would strand the funds (only that key can redeem, they never will,
  the token isn't a grabbable bearer note, and there's no refund path). The
  `:nut` marker is that proof-of-capability, so we only ever lock to peers that
  can actually collect. The marker sits *after* the npub so stock iOS
  (`split(":")[1]`) and stock Android (`substringAfter(":")`) still recover a
  usable npub and harmlessly ignore the suffix.
- **One initiator per pair.** Eager *mutual* favoriting makes both peers start a
  Noise XX handshake at the same instant — and XX needs exactly one initiator and
  one responder, so two simultaneous initiators collide and the session never
  establishes. We resolve it the standard way: the lower-peerID side initiates,
  the higher side defers and sends its favorite once the single session is live.

## What's standard vs. what we added

**Standard, reused unchanged:** the favorite notification (identity), the public
mesh message (delivery), NUT-11 P2PK (the lock), and the Nostr secp256k1 identity
(the key).

**Non-standard, kept as small as possible:**

| Addition | Why it's minimal |
|---|---|
| **`:nut` suffix** on the native favorite — the *only* wire addition | Rides the existing favorite message; placed after the npub so both stock parsers still read the npub. Flags cashu-capability and gates locking (above). |
| **Eager favoriting** | Behavior only, no wire change — the only way to learn a key bitchat doesn't put in the announce. |
| **Single-initiator handshake tie-breaker** | Behavior only, in our bridge code — the standard fix for simultaneous Noise handshakes (no vendored-Noise change). |
| A few **build/privacy patches** to vendored bitchat (mainnet BLE UUID in debug, neighbor-gossip suppression, a link-state de-privatize, an announce sender-mismatch relax for old App Store builds, split-module import fix-ups) | **None are cashu-specific.** |

**Deliberately NOT done:** no custom announce TLV / capability beacon, no new
packet type, no new Noise payload type, no protocol-version bump, and no
dependency on >255-byte DMs.

## Do the same in another client

1. Emit `[FAVORITED]:<your npub>:nut` to peers (eagerly, to be discoverable), and
   tie-break the Noise handshake (lower peerID initiates).
2. On a `:nut` favorite, record `peer → npub`; treat a bare `[FAVORITED]:npub` as
   **not lockable** (the fund-safety gate above).
3. To pay: NUT-11-lock to `02`+npub and broadcast on the public mesh.
4. Classify inbound public cashu tokens: locked-to-you → auto-redeem (park
   untrusted mints), locked-to-other → ignore, bearer → manual tap.

Every byte rides a mechanism bitchat already ships.

## Upstream context

bitchat's maintainer **Jack** ([@jackjackbits](https://github.com/jackjackbits))
keeps the protocol intentionally small and lets third-party *protocol* PRs sit;
cashu-adjacent work is routed to Calle (the Cashu author / repo collaborator)
off-GitHub. That's why we touch the wire as little as possible and reuse native
channels.

The only Cashu code **merged** upstream is read-only **chip rendering** — detect
a `cashu…` / `lnbc…` string in a message and show a tappable chip (the
`MessageFormattingEngine`, PR #891/#961 + the *"Normalize Cashu chip URLs"* /
*"Feat/b links"* commits). There is **no** merged wallet, lock, redeem, or
payment protocol — everything below is open or closed, so our approach doesn't
conflict with anything shipped. Relevant threads on
[`permissionlesstech/bitchat`](https://github.com/permissionlesstech/bitchat):

- **[#784](https://github.com/permissionlesstech/bitchat/issues/784)** — *Allow
  private message content to exceed 255 bytes* (OPEN). The exact cap that blocks
  a private-DM design; maintainer says it's protocol-breaking and needs
  iOS+Android lockstep.
- **[#1053](https://github.com/permissionlesstech/bitchat/pull/1053)** — *add
  Lightning and Cashu payment packets to the Noise protocol layer* (OPEN PR). The
  heavier path we avoided: new `NoisePayloadType`s + a new packet model for
  *bearer* tokens. We get the same outcome with NUT-11 on the public mesh.
- **[#1327](https://github.com/permissionlesstech/bitchat/pull/1327)** — *Fix
  Cashu long-message guard bypass* (OPEN, maintainer's) — confirms his direction:
  structured payloads over giant raw-text cashu blobs.
- **[#1073](https://github.com/permissionlesstech/bitchat/issues/1073)**
  (*SDK packages*) and
  **[#124](https://github.com/permissionlesstech/bitchat/issues/124)**
  (*WHITEPAPER enhancement for client compatibility*) — demand for an official
  extension/interop story, but none exists; another reason to stay native.
- Prior cashu-over-mesh attempts:
  **[#416](https://github.com/permissionlesstech/bitchat/issues/416)** /
  **[#417](https://github.com/permissionlesstech/bitchat/issues/417)** (cashu for
  hops / per-message read), bitchat-android
  **[#506](https://github.com/permissionlesstech/bitchat-android/pull/506)**
  (*Feat/dm 2byte tlv* — the bitpoints 2-byte-TLV cashu DM),
  bitchat-android
  **[#132](https://github.com/permissionlesstech/bitchat-android/pull/132)**
  (*Parse cashu* — an early cashu-parsing PR, closed/unmerged), and
  **[#679](https://github.com/permissionlesstech/bitchat/issues/679)**
  (deep-link cashu redeem).
- Adjacent: **[#283](https://github.com/permissionlesstech/bitchat/issues/283)**
  (remove compression) and
  **[#368](https://github.com/permissionlesstech/bitchat/issues/368)** (nostr).
