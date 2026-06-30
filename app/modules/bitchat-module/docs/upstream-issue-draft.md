# Upstream outreach — Cashu over bitchat (favorite-channel approach)

> Local draft only — review, edit, and send it yourself. Nothing in this repo
> posts anything upstream. Full design: [`nut18-bitchat-transport.md`](./nut18-bitchat-transport.md);
> interop contract: [`cashu-bitchat-compatibility.md`](./cashu-bitchat-compatibility.md).

## Why there's almost nothing to ask upstream

Earlier drafts proposed an announce-TLV beacon and a documented vendor-range for
announce TLVs / Noise payload types, plus a cross-platform signing fix for
compressed announces. **The current design needs none of that.** Identity +
accepted-mint advertisement travel on bitchat's existing favorite notification
(carrying a standard NUT-18 `creq`); the token travels on a private Noise DM. The
only wire change is a **backward-compatible widening of our own private-message
content length** (≤254 B stays byte-identical to stock; only our clients decode a
larger message). There's no new packet type, no new Noise payload type, no
announce TLV, and nothing to ask upstream to reserve — bitchat #784 tracks a
protocol-wide cap lift, but we don't depend on it. The one artifact worth sending
is a heads-up to the cashu reviewer.

## Calle brief (off-GitHub outreach)

> Short message for Calle (Cashu author, bitchat collaborator — the designated
> reviewer for cashu-adjacent bitchat work, who asked the bitpoints author to
> take exactly this conversation to DMs). Telegram / X / Nostr; trim to taste.

Hey — we built Cashu over bitchat with **near-zero protocol change**. To learn a
nearby peer's key *and* its accepted mints we reuse bitchat's own favorite
notification: a Sovran client sends `[FAVORITED]:<npub>:<creq>` — the native
favorite message, plus a standard **NUT-18 payment request**. The npub *is* the
peer's identity and, `02`-prefixed, the NUT-11 P2PK lock target; the creq
advertises which mints the peer accepts and carries its lock key, so we only ever
lock to a **shared** mint (or block the send with a clear message when there's no
overlap) — never an unredeemable token. Same idea as numo's mint advertisement,
extended with a standing request + P2PK lock. We deliver the whole token as one
**private Noise DM** to the peer (encrypted to them), which is private for both
locked and bearer tokens. The 255-byte private-message cap was a message-format
limit, not a radio one, so we widened our own content-length field
backward-compatibly (≤254 B identical to stock). No new packet/payload type, no
announce TLV; payments are Sovran↔Sovran. Shipping in Sovran on iOS + Android.
Two things we'd love your read on: (1) using the favorite channel as the
cashu-identity + mint-advertisement exchange, and (2) using a NUT-18 `creq` as the
capability/mint signal — does that match how you'd want wallets to flag
cashu-capability and accepted mints to each other over the mesh, or would you
prefer a different signal?
