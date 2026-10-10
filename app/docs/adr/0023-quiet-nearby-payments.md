# 23. Nearby discovery is wallet-scoped; payment identity is transport-independent

Date: 2026-10-03
Status: Accepted

Home prepares a directory of nearby wallets and their Nostr profiles. Send and
NutDrop consume that directory; a receiver need not open a payment screen.
The directory may start cold, and operating-system suspension still limits
background work. “Passive” describes the user's experience, not a radio that
never advertises or connects: two listeners alone cannot exchange capabilities.

## Stock clients control their own notifications

Normal wallet activity uses a distinct BLE service. An explicitly visible chat
or network view opts into the public Bitchat mesh, using a single restarted
engine with an instance-scoped discovery UUID. Leaving that surface releases
public participation. This avoids unsolicited public membership and favorite
notifications during normal wallet use.

There is an unavoidable reachability tradeoff: a wallet hidden from stock mesh
members cannot also rely on those members as its sole relay path. Public mesh
routing remains available during explicit public participation. We do not promise
simultaneous invisible discovery and stock relay reachability. Service UUIDs are
filters, not access control, anonymity, or protection from radio observation.

## A recipient must control its advertised keys

Native announce and favorite fields are self-assertions. A short-lived signed
Nostr capability binds the standing request to the remote static key authenticated
by Noise XX. Payment rows require a fresh valid capability, matching P2PK lock key
and compatible request. Profile metadata is display information; a signature
proves key control, not a real-world identity or reputation.

The nearby standing request has its own durable identity, independent of the
Receive screen's request rotation. Trust-set changes withdraw the old advertised
capability while a replacement is prepared. Old request operations remain able
to reconcile payments already in flight.

## One operation owns funds; transports only deliver

Nearby sends are P2PK-only. Failure to create a lock blocks the send instead of
silently switching to bearer ecash. Before execution, a profile-bound secure vault
binds the send operation to its exact recipient and request. Closing or changing
a UI session cannot redirect that operation's token.

The journal persists one NUT-18 payload and the original signed Nostr envelope
before publication. Bluetooth and Nostr may deliver concurrently. Both enter
Coco's incoming request API, whose canonical payload identity prevents duplicate
receives. Native ACKs and relay acceptance are delivery progress, not settlement.
Retries reuse the operation, payload and signed envelope. Bluetooth uses a new
transport message ID when retrying because its ACK precedes durable JS ingestion.

Radio input is checked for recipient lock, known request, trusted accepted mint
and DLEQ before it can occupy the durable inbox. Storage failure never resets
custody state or permanently poisons the retry loop. A rejected request payload
is retained encrypted because Coco can discard it; rejection is not receipt and
must not trigger a second automatic receive. Legacy token DMs remain receive-only
compatibility input, with their existing trust and DLEQ checks.

## Evidence has boundaries

The [wire contract](../../modules/bitchat-module/docs/README.md) describes
compatibility and native patch ownership. Tests cover signed identity binding,
lock-only policy, operation-bound delivery, storage failure, original-envelope
replay, rejected payload retention, profile isolation, and direct Send navigation.
The [physical scenario](../../e2e/scenarios/nearby-select-from-send.json) selects a
receiver from Send while the receiver stays on Home, without creating a payment.

Type checks, JavaScript bundles and native simulator compilation do not prove
Bluetooth interoperability or actual settlement. iOS/iOS, iOS/Android and
Android/Android notification silence, background/resume, profile/radio changes,
public mesh routing, and simultaneous delivery/crash recovery remain explicit
[device verification work](../../../docs/architecture/follow-ups.md).
