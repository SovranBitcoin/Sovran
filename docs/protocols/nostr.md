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

### Blocking, reports, and message filtering

Post menus offer **Hide post**, **Block person**, and **Report post**. Profile
and Nostr/White Noise direct-message headers also offer block and report actions.
**Settings → Moderation** lists blocked accounts, supports unblocking and retrying
failed synchronization, and edits an optional message-filter dictionary.

Person blocks use [NIP-51 kind 10000 mute lists](https://github.com/nostr-protocol/nips/blob/master/51.md).
New entries are encrypted to the account with NIP-44; legacy NIP-04 lists are
readable. Existing public entries and unfamiliar tags are preserved. Local
blocking is immediate, including when synchronization fails. The imported
account's list is fetched at startup, on foreground, and on manual refresh.
Unreadable lists are never replaced. A first block creates the encrypted list automatically after configured relays
confirm the read. A timeout or unreadable list keeps the block local for retry;
there is no separate list-creation prompt.
As with other Nostr replaceable lists, simultaneous edits in different clients
cannot be merged atomically across relays. A relay acknowledgment does not promise
permanent storage; recovery needs access to the relays that hold the list.

Reports are [NIP-56 kind 1984 events](https://github.com/nostr-protocol/nips/blob/master/56.md).
The reason, reporter, reported account, and selected public post ID are public;
the confirmation explains this before signing. Reporting a DM contact includes
only the account and reason, never the private message text or its envelope ID.
These reports do **not** constitute an operated moderator queue or guarantee
review, removal, or an answer from Sovran.

The dictionary is off by default and stored locally per account. It matches
literal case-insensitive words/phrases, hides incoming Nostr, White Noise, and BitChat Nostr-DM
bubbles until **Reveal censored message** is pressed, and replaces matching
incoming contact previews with `[censored]`. It does not inspect images, provide
an age gate, or moderate BitChat BLE/private mesh and public chat rooms. Blocks hide content in
this account; they cannot prevent other people reading public Nostr posts.

These controls alone do not establish store-policy compliance. Google Play
[requires ongoing UGC moderation and timely action on reports](https://support.google.com/googleplay/android-developer/answer/9876937),
and incidental sexual content has additional default-hiding and age-screening
requirements. A voluntary local word filter must not be described as satisfying
those requirements.

## The data layer

The app queries an app-view (the default deployment is **Nagg**, self-hostable)
through the `nostr` package's GraphQL/REST client, falling back across a tiered
strategy (nagg → Primal → relay). See [Provider setup](/protocols/provider-setup)
for how the data layer is assembled, and
[Navigation and routes](/protocols/navigation-and-routes) for how screens consume it.
