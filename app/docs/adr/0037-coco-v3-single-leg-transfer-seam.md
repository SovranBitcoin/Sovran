# Rebalancing moves money through a single-leg transfer seam shaped like Coco v3

Accepted on 2026-11-24.

Upstream Coco's next major version adds `manager.ops.mintSwap`, one operation that moves
value from one mint to another. It is not published, and ADR 0017 keeps the wallet core
unmodified, so Sovran stays on `@cashu/coco-core@2.0.0`.

The rebalance engine instead calls a `SingleLegTransferPort`: one transfer from a source
mint to a destination mint, with the same inputs, result and failure states as
`manager.ops.mintSwap`. Today's implementation composes it from a Coco mint quote and melt.
The port returns one transfer identifier and never exposes the child mint or melt operation
IDs, so callers cannot come to depend on how a transfer is built.

The engine keeps what it relies on now. A leg whose outcome is unknown stays in
`unsettledMints`, so its mint is not drawn from again until it settles, and multi-hop plans
are still routed by the engine as a sequence of single legs.

When Coco v3 is published, adopting it replaces the port's implementation with a call to
`manager.ops.mintSwap`; the engine and its tests do not change.

## Adopted (2026-11-26)

Upgraded `@cashu/coco-core` to `0.0.0-nightly-20261120132306-58abfae` (`cashubtc/coco@58abfae8`),
which ships `manager.ops.mintSwap`. `wallet/src/rebalance/engine.ts` now drives
`manager.ops.mintSwap` directly for every hop, and the interim `SingleLegTransferPort` shim
(`wallet/src/rebalance/singleLegPort.ts`) has been removed.
