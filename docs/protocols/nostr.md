# Nostr

Sovran uses Nostr for wallet identity, contact lookup, mint reviews, and encrypted
payment messages (NIP-17). Relay connections, signing, and NIP-44/NIP-59 gift-wrapping
run directly on `nostr-tools` through the in-repo `nostr` package (`NostrClient` and
the tiered data layer).

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
- **NIP-04** — legacy encrypted DMs. Their event metadata exposes sender and
  recipient public keys; this is not the same metadata protection as NIP-17.

The client encrypts and decrypts supported DMs; relays transport encrypted
events rather than receiving the message-decryption keys. That boundary is not a
guarantee about relay logging, metadata, device compromise, or recipient behavior.
Relays can observe routing and connection information, and recipients can copy
decrypted messages.

`giftWrapCache` uses the app's AsyncStorage-backed `createPubkeyScopedCache`,
with a persistence filter that keeps decrypted bearer ecash tokens (`cashuA`/`cashuB`,
NUT-18 proofs) in memory only so they are never written to plaintext AsyncStorage.
Profile scoping is not encryption at rest; do not describe locally cached non-bearer
messages as encrypted. See the source-scoped
[claims review](https://github.com/SovranBitcoin/Sovran/blob/main/CLAIMS.md),
[NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md),
[NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md), and
[NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md).

Relay acceptance does not prove that a recipient received or read a message.
Relays can refuse or remove events, impose access rules, and become unavailable.

## The data layer

The app reads profiles and contacts through the tiered data layer (Primal and
direct relays, asked together; the newest event wins) built by
`buildNostrDataLayer()`, and publishes through `nostr/client` (`NostrClient` +
`RelayPool`). Profile reads are batched: every profile asked for within one
frame goes out as one request per source.

Payment-inbox events (ecash sent as a message, payment-request replies) are read
through a separate inbox (`paymentInbox.ts`) that always uses the default relays.
It does not depend on the tier switches in Settings → Network, so switching the
relay tier off changes where profiles load from and does not stop payments
arriving. See
[Provider setup](/protocols/provider-setup) for how the client and data layer
are assembled, and [Navigation and routes](/protocols/navigation-and-routes)
for how screens consume them.
