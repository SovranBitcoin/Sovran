# Nostr

Sovran uses Nostr for identity, social, and messaging. Keys are derived per
profile; the feed and app-view queries are served through the in-repo `nostr`
package (formerly `nagg-ts`).

## Identity & keys

- **NIP-06 multi-account derivation** — BIP-32/BIP-39 at `m/44'/1237'/<account>'/0/0`.
  Every Sovran profile derives its Nostr key from one mnemonic at a different
  account index.
- **nsec import** — paste an existing `nsec1…` to bring an external identity into
  a profile (bypasses derivation for that profile).
- **Multi-profile isolation** — each profile has its own Nostr keys, BLE-mesh
  identity, and balances; switching profiles remounts providers.

## Identity resolution

- **NIP-05** — DNS-based mapping from `local@domain` to a Nostr pubkey via
  `/.well-known/nostr.json?name=<local>`.
- **Vertex** — trust-ranked search and follower-graph reputation, surfaced inline
  on contact rows and payment-recipient confirmations.

## Direct messages

- **NIP-17 private DMs** — `kind 14` rumors sealed and gift-wrapped per NIP-59
  (`kind 1059`), encrypted with NIP-44 v2.
- **NIP-04** — legacy encrypted DMs with a decrypt cache (kept for backwards
  compatibility).

The app-view (nagg) is **zero-knowledge for DMs**: it relays encrypted envelopes
and never decrypts.

## Feed & social

The feed renders `kind 1` text notes (NIP-01) with a follow-graph home timeline
(`kind 3`), threads, reactions (NIP-25), reposts (NIP-18), image/video, and
mute/ignore. Relay management uses `@nostr-dev-kit/ndk-mobile`; low-level signing
and encoding use `nostr-tools`.

## The data layer

The app queries an app-view (the default deployment is **Nagg**, self-hostable)
through the `nostr` package's GraphQL/REST client, falling back across a tiered
strategy (nagg → Primal → relay). See [Provider setup](/protocols/provider-setup)
for how the data layer is assembled, and
[Navigation and routes](/protocols/navigation-and-routes) for how screens consume it.
