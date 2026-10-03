# Nearby wallet payments over Bitchat

The [architecture decision](../../../docs/adr/0023-quiet-nearby-payments.md)
explains discovery, identity and payment ownership. This document is the wire
contract for compatible wallets; it does not establish physical interoperability.

## Discovery is quiet to stock clients

Sovran's account provider starts a wallet-only Bitchat engine on Home, using BLE
service UUID `7C6A0001-5A8B-4C9D-AE10-534F5652414E`. Both scan and advertise use
that service. Stock Bitchat clients do not scan it, so normal wallet discovery
does not introduce Sovran into their public peer lists or trigger their peer
notifications. This is active radio discovery with background preparation for
the UI, not radio silence or an OS background-execution guarantee.

An explicitly visible Bitchat chat or network screen leases the stock mainnet
service (`F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C`). The single engine restarts when
that mode changes. Leaving the surface returns to wallet discovery. Public mesh
participation is visible to stock clients; an invisible idle wallet cannot also
be reached exclusively through stock mesh relays. Already identified wallets
can use public mesh routing while both endpoints participate in that mesh.

## Identity must be proved before payment

A native announce or favorite is not proof of a Nostr identity. Wallet peers
establish Noise XX, with the lower lexicographic peer ID initiating, and exchange
private messages prefixed `sovran:nearby:1:`. The remainder is a signed Nostr event:

- kind `21118`, empty tags, current `created_at`, signer = profile Nostr key;
- JSON content `{ protocol: "sovran-nearby", version: 1, noiseKey, expiresAt, creq }`;
- `noiseKey` is the 32-byte Noise static public key in lowercase hex;
- `expiresAt` is Unix seconds, at most 120 seconds after `created_at`;
- `creq` is a reusable, amountless `sat` NUT-18 request, or `null` to withdraw.

The receiver verifies the event signature and freshness, then compares
`SHA256(noiseKey)` with the remote static key authenticated by its established
Noise session. It verifies that the request's P2PK key equals `02` plus the event
signer and any Nostr transport addresses that same signer. This proves control
of keys, not a person's identity or trustworthiness. Native favorite fields do
not qualify a recipient.

Capabilities refresh privately while the wallet service is active. Unknown stock
clients never receive this wallet extension. Send and NutDrop share the warm,
verified directory and cached profile metadata; cold starts and profile misses
can still require discovery or a network lookup.

## One payment can use two transports

Send and NutDrop offer only fresh, authenticated, lock-capable wallets. A shared
accepted mint is required. The sender creates P2PK-locked proofs; if a lock cannot
be created offline, the send is blocked. There is no bearer downgrade.

Before executing the Coco send, Sovran durably binds its operation ID to the
selected recipient and exact request. It then persists one NUT-18 JSON payload
containing `id`, `mint`, `unit` and `proofs`. Bluetooth carries
`sovran:payment:1:` followed by those bytes inside a private Noise DM. Nostr
carries the same payload inside the request's NIP-17 gift wrap. A retry reuses
the payment and payload; it does not create another send.

Bluetooth admission requires proofs locked to this wallet, a known local request,
a compatible mint and local DLEQ verification. Accepted input is durably queued
before settlement. Both transports use Coco's incoming payment-request API,
whose request ID plus canonical payload hash deduplicates the claim. A native
Bluetooth ACK or a relay OK proves transport progress, not redemption. Bluetooth
retries until the send settles because a native ACK can precede JS persistence.
Rejected input remains retained for recovery; it is never reported as received.

Legacy whole-token private messages remain receive-only compatibility input.
They use the existing mint-trust and DLEQ gates, but have no cross-transport
request identity. New outgoing payments never use that path.

## Private message framing

Bitchat's encrypted packets already fragment over BLE. Sovran extends only the
private content TLV: lengths `0x00` through `0xFE` retain the stock one-byte form;
`0xFF` is followed by a two-byte big-endian length for larger content. Message IDs
retain one-byte lengths. Ordinary chat is chunked to at most 254 bytes so stock
recipients never encounter the extension. Wallet control messages are private,
capability-gated, and excluded from chat history and notifications.

See the [review findings and verification record](verification.md) for checks
and remaining device gaps.

## Vendoring and native builds

The owned patch scripts are the source of native modifications; generated vendor
sources must not be edited manually. Upstream licenses remain in each vendor tree.

| Platform | Pinned revision | Refresh from repository root |
| --- | --- | --- |
| iOS | `3be8fbf1c425337def5eb9b75aa9b563e22cf048` | `node app/modules/bitchat-module/scripts/patch-bitchat-imports.js` |
| Android | `4dfec917c822368a90bf0ae046e3cb354fbd6cd6` | `node app/modules/bitchat-module/scripts/sync-bitchat-android.js` |

The iOS script patches its submodule in place. Android copies an anchored,
headless subset into ignored `vendor-src`. Preserve the directed-fragment
headroom and Android header-size corrections: encrypted frames must fit GATT's
512-byte boundary. Also preserve stale-session re-handshake recovery, genuine
startup failure reporting, instance-scoped discovery UUIDs and authenticated
session-key access. Remove a patch only after the pinned upstream implements
its behavior and cross-platform regression checks pass.

Metro, TypeScript and Jest resolve the owned module source. A JavaScript reload
cannot update native bridges: both platforms require rebuilt binaries. The
native startup log records the vendor revision. See the
[verification follow-up](../../../../docs/architecture/follow-ups.md) for the
physical-device matrix; JavaScript tests and simulator compilation cannot prove
radio discovery, OS background behavior, or BLE/Nostr settlement races.
