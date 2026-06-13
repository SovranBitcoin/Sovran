# Upstream outreach — Cashu over bitchat (favorite-channel approach)

> Local draft only — review, edit, and send it yourself. Nothing in this repo
> posts anything upstream. Full design: [`nut18-bitchat-transport.md`](./nut18-bitchat-transport.md);
> interop contract: [`cashu-bitchat-compatibility.md`](./cashu-bitchat-compatibility.md).

## Why there's no GitHub issue here anymore

Earlier drafts proposed an announce-TLV beacon and a documented vendor-range for
announce TLVs / Noise payload types, plus a cross-platform signing fix for
compressed announces. **The current design needs none of that** — it adds **zero
new wire format**. Identity travels on bitchat's existing favorite notification;
ecash travels on the existing public mesh. So there is nothing to ask upstream to
reserve, document, or change. The only artifact worth sending is a heads-up to
the cashu reviewer.

## Calle brief (off-GitHub outreach)

> Short message for Calle (Cashu author, bitchat collaborator — the designated
> reviewer for cashu-adjacent bitchat work, who asked the bitpoints author to
> take exactly this conversation to DMs). Telegram / X / Nostr; trim to taste.

Hey — we built Cashu over bitchat with **no protocol changes at all**. To learn a
nearby peer's key we reuse bitchat's own favorite notification: a Sovran client
sends `[FAVORITED]:<npub>:nut` (the native favorite message, plus a `:nut` tag so
two cashu wallets recognise each other — stock clients still parse the npub and
ignore the tag). That npub *is* the peer's identity and, `02`-prefixed, the
NUT-11 P2PK lock target. To pay, we lock a token to it and broadcast on the
existing public mesh — a locked token is safe in the open because only the
recipient can redeem it, and everyone else (including our own echo) ignores it.
Receivers auto-redeem anything locked to their key; untrusted mints get parked.
No new packet type, no new Noise payload type, no announce TLV, no >255B DM
dependency. Shipping in Sovran on iOS + Android now. Two things we'd love your
read on: (1) using the favorite channel as the cashu-identity exchange, and
(2) the `:nut` capability tag (does that match how you'd want wallets to flag
cashu-capability to each other over the mesh, or would you prefer a different
signal?).
