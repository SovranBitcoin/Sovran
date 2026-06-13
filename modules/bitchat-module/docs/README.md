# Cashu over bitchat (Sovran) — how it works

Send P2PK-locked Cashu ecash to a nearby bitchat peer, **offline**, by reusing
bitchat's own mechanisms — no protocol fork. This is the 1-page overview; the
full byte-level spec is [`cashu-bitchat-compatibility.md`](./cashu-bitchat-compatibility.md)
and the rationale is [`nut18-bitchat-transport.md`](./nut18-bitchat-transport.md).

## The whole thing in four steps

1. **Learn identity** — a peer's Nostr pubkey arrives in bitchat's native
   favorite notification: `[FAVORITED]:<npub>:nut` (a Noise-encrypted private
   message). The npub *is* the peer's identity.
2. **Lock** — P2PK-lock (NUT-11) a Cashu token to `02` + that x-only pubkey.
3. **Deliver** — broadcast the locked token as an ordinary **public** mesh
   message (already fragmented; stock bitchat renders it as a `cashu…` chip).
4. **Redeem** — the receiver auto-redeems anything locked to its key; everyone
   else (including the sender's own echo) ignores it. A locked token is safe in
   the open because only the target key can redeem it.

The peer's x-only Nostr key is one value used three ways: kind-0 profile key,
identity, and (02-prefixed) the P2PK lock target.

## What's standard (reused unchanged)

- bitchat's **favorite notification** — its only native mesh channel for sharing
  a Nostr identity.
- bitchat's **public mesh message** — already fragmented; already chip-rendered.
- **NUT-11 P2PK** lock — standard Cashu.
- **Nostr** secp256k1 identity — the key everything keys off.

## What we added (and why each is as small as possible)

| # | Non-standard bit | Why minimal |
|---|---|---|
| 1 | **`:nut` suffix** on the favorite (`[FAVORITED]:npub:nut`) — the *only* wire addition | Rides the native favorite message. Placed *after* the npub so stock iOS (`split(":")[1]`) and stock Android (`substringAfter(":")`) still recover a usable npub. It only flags "I'm a cashu wallet" so two wallets recognise each other; a bare favorite (a stock user who favorited us) is treated as **not lockable**, so we never lock funds to a key that can't redeem. |
| 2 | **Eager favoriting** — we favorite every peer on discovery | Behavior only, no wire change. Needed because bitchat puts **no** Nostr key in its announce, so the only way to learn a peer's key is to exchange favorites. |
| 3 | **Single-initiator handshake tie-breaker** (lower peerID initiates) | Behavior only, no wire change. Eager *mutual* favoriting makes both peers start a Noise XX handshake at once; XX needs exactly one initiator, so one side defers. (This is the standard simultaneous-handshake resolution, à la WireGuard.) |
| 4 | A few **build/privacy patches** to vendored bitchat — force mainnet BLE UUID in debug, suppress the neighbor-gossip announce TLV (privacy), de-privatize a link-state getter, relax an announce sender-mismatch check for old App Store builds, comment out split-module imports | **None are cashu-specific.** No announce TLV, no new packet type, no new Noise payload type, no signing change. |

## What we deliberately did NOT do

No custom announce TLV / capability beacon, no new Noise payload type, no new
packet model, no protocol-version bump, and no dependency on >255-byte DMs. We
went out of our way to avoid the heavier paths other proposals took (see below).

## Do the same thing in your client

1. Emit `[FAVORITED]:<your npub>:nut` to peers (eagerly, so you're discoverable),
   and tie-break the Noise handshake (lower peerID initiates).
2. On receiving a `:nut` favorite, record `peer → npub`; treat a bare
   `[FAVORITED]:npub` as **not lockable**. This gate is the fund-safety
   invariant: **never P2PK-lock ecash to a peer unless you have positive proof
   it runs a cashu-aware wallet that can redeem it.** A bare favorite comes from
   a plain bitchat user — locking to their key would strand the funds, because
   only that key can redeem and they never will (the token isn't a bearer note
   they can grab, and there's no refund path). The `:nut` marker is that
   proof-of-capability: it says "this key belongs to a wallet that understands
   and can redeem P2PK Cashu," so you only ever lock to peers that can actually
   collect.
3. To pay: NUT-11-lock to `02`+npub and broadcast on the public mesh.
4. Classify inbound public cashu tokens: locked-to-you → auto-redeem (park
   untrusted mints), locked-to-other → ignore, bearer → manual tap.

That's it — every byte rides a mechanism bitchat already ships.

## Upstream context (why we minimized)

Maintainer **Jack** ([@jackjackbits](https://github.com/jackjackbits)) keeps the
protocol intentionally small and lets third-party *protocol* PRs sit; cashu work
is routed to Calle (the Cashu author / repo collaborator) off-GitHub. So we
touch the wire as little as possible and reuse native channels. Relevant
[`permissionlesstech/bitchat`](https://github.com/permissionlesstech/bitchat)
threads:

- **[#784](https://github.com/permissionlesstech/bitchat/issues/784)** — *Allow
  private message content to exceed 255 bytes* (OPEN). Jack: protocol-breaking,
  needs iOS+Android lockstep. This is why we **don't** deliver ecash over DMs (a
  locked token exceeds 255 B) and use the public mesh instead.
- **[#1053](https://github.com/permissionlesstech/bitchat/pull/1053)** — *add
  Lightning and Cashu payment packets to the Noise protocol layer* (OPEN PR).
  The heavier path we avoided: new `NoisePayloadType`s + a new packet model, for
  *bearer* tokens. We get the same outcome with NUT-11 on the existing public
  mesh and no new packet type.
- **[#1327](https://github.com/permissionlesstech/bitchat/pull/1327)** — *Fix
  Cashu long-message guard bypass* (OPEN, Jack's). Confirms his direction:
  structured payloads over giant raw-text cashu blobs.
- **[#1073](https://github.com/permissionlesstech/bitchat/issues/1073)** —
  *Proposal: SDK packages for the BitChat protocol* (OPEN) and
  **[#124](https://github.com/permissionlesstech/bitchat/issues/124)** —
  *WHITEPAPER.md enhancement for client compatibility* (OPEN): there's demand for
  an official extension/interop story, but none exists — another reason to stay
  on native mechanisms.
- Prior cashu-over-mesh attempts:
  **[#416](https://github.com/permissionlesstech/bitchat/issues/416)** /
  **[#417](https://github.com/permissionlesstech/bitchat/issues/417)** (cashu for
  hops / per-message read),
  bitchat-android
  **[#506](https://github.com/permissionlesstech/bitchat-android/pull/506)**
  (*Feat/dm 2byte tlv* — the bitpoints 2-byte-TLV cashu DM),
  **[#679](https://github.com/permissionlesstech/bitchat/issues/679)** (deep-link
  cashu redeem).
- Adjacent: **[#283](https://github.com/permissionlesstech/bitchat/issues/283)**
  (remove compression — relevant to cross-platform signing) and
  **[#368](https://github.com/permissionlesstech/bitchat/issues/368)** (nostr).

> Nothing in this repo is posted upstream automatically. Paste-ready outreach to
> Calle lives in [`upstream-issue-draft.md`](./upstream-issue-draft.md).
