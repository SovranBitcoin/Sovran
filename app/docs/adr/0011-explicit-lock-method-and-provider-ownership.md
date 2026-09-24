# Explicit lock methods and provider-owned catalogs

Date: 2026-09-24
Status: Accepted; native verification outstanding.

Supersedes the header-toggle and uncertainty-copy decisions in
[ADR 0010](0010-p2pk-locked-sends.md). The user's review request explicitly
asks for Ecash, Lightning and Lock Ecash in the same payment-method menu.

## Decision

An editable lock belongs to the `locked-ecash` amount action. That action
collects its spending conditions before execution; cancelling the chooser
does not send. Ordinary Ecash clears the editable choice. Protocol-supplied
locks remain authoritative. Both the amount transition and the operation
boundary reject malformed requested locks, rather than turning them into
bearer tokens.

The timeline owns the explanation and expandable spending-condition details.
Statements about this wallet reclaiming funds require the wallet-owned
reclaim verdict; a refund tag alone does not prove ownership or signing
support. Timed state updates at its boundary and after foregrounding, including
durations longer than the platform's single-timer limit.

When using a Nostr identity key instead of a published wallet key, say which
key is used and that redemption needs a wallet capable of signing with it.
Do not describe this as uncertainty about the protocol. Also, ADR 0010's
claim that changing a compressed key's `03` prefix to `02` makes it
cryptographically unredeemable is incorrect: NUT-11 compares Schnorr keys by
x coordinate. A wallet's exact-key lookup is a separate implementation
constraint. Preserve supplied keys rather than relying on a lookup to
normalize them.

A selected provider owns its model catalog. A different provider's cached or
server-supplied lineup must not be relabelled as the selected provider's.
The model picker and send gate use spendable sat balances from a single
compatible wallet mint, not a hosted-account balance or the sum of several
mints. Optional metadata must not delay an already-fetched model menu;
payment waits for in-flight mint metadata before selecting its funding mint.

Provider discovery may add rows, but metadata and health updates preserve
existing positions while the list is open. A missing optional information
endpoint is unknown health, not proof that a provider is offline.

## Evidence and limits

Regressions cover invalid locks, recipient/profile switches, expiry beyond
30 days, catalog ownership, malformed mint URLs and provider-row stability.
These tests do not prove native visual layout, real provider responses or a
funded reclaim. [ADR 0012](0012-routstr-durable-profile-bound-recovery.md)
defines the separate recovery-storage and payment-boundary guarantees.
