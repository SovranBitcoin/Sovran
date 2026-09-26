# Mint liveness is feedback, not a gate

Date: 2026-09-26
Status: Accepted; device check outstanding.

## Context

Provider rows carry a presence dot fed by probing `/v1/info`, and an offline
provider cannot be chosen. Mint rows carried nothing: the selector's `status`
means "pickable in this flow", the `'offline'` stat means "can send this amount
offline", and the audit dot on the mint page is the auditor's verdict. Nothing
said whether a mint was answering right now, and nagg recorded reachability
only once a day, for its changelog.

## Decision

Mint rows (selector, discovery) and the wallet header's mint pill show the
same dot as providers, from `shared/lib/cashu/mintHealth.ts`. The verdict is
persisted on the mint's `mintMetadataStore` entry (`liveness`, `livenessAt`,
`livenessSource`): this phone's `/v1/info` probe and nagg's sweep write the
same field and the newer stamp wins. `selectMintLiveness` reads it on the
first frame, falling back to the auditor's standing state ("OK"/"ERROR", the
same badge the mint page's avatar wears) as a proxy while a background sweep
brings stale rows up to date, so a row never waits on the network for its
dot. The identity refresh the selector already makes counts as evidence. nagg runs a five-minute probe (`internal/mintliveness`) and
publishes `status`, `checkedAt`, `latencyMs` on discovery and mint-info rows
with the provider directory's semantics.

Unlike providers, liveness never disables a mint row, never changes its
`status`/`reason`, and never reorders the list. Ecash sent to a mint that is
down is redeemed when it returns, so "down" is information for the reader, not
a reason to block a flow.

## Consequences

- `MintStatFields.presence` is a separate field from `status`; ContactRow draws
  it on the mint icon exactly as on the provider face.
- The discovery list probes only visible rows; a 200-row list never sweeps.
- A mint that is offline to nagg but online to this phone shows online.
