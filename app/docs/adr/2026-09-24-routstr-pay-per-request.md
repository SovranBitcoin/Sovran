# Pay Routstr per request, through its SDK

Status: accepted; device validation of the payment round trip outstanding.

Supersedes the first revision of this ADR, which recorded the same payment
model implemented by hand and gave reasons against adopting `@routstr/sdk`.
Those reasons are answered below; the payment decision is unchanged.

## What forced the decision

Sovran opened a hosted account on one Routstr node: deposit once, spend down a
balance keyed to `sk-<sha256(token)>`, a row in *that node's* database. nagg
moves its node pick on catalog health alone and the app follows, so the key
routinely ended up addressed at a node that never issued it. The 401 that
produced was read as "spent" and the key — the only bearer instrument for the
deposit — was deleted. A routine node change silently ate the balance. It ate
250 sats on 2026-09-24, and the header went on showing them.

## Decision

**Pay per request out of the wallet, and let `@routstr/sdk` carry the
request.** Routstr's `X-Cashu` mode puts a Cashu token on the request; the node
redeems it, does the work, and returns the change in the response header.
Nothing is held on a node between requests, so nothing can be stranded and
switching provider costs the user nothing. The Sovran wallet is the only
balance there is.

The SDK owns the parts that are Routstr's: pricing a request the way the node's
admission gate does, minting and attaching the token, sealing the body for a
Tinfoil enclave over EHBP, redeeming the change, recording the token in between
so a request that dies mid-flight can still be chased, and failing over.

Sovran keeps the parts that are Sovran's: which node, which mint, the wallet
itself, this app's error classification, the spend confirmation, and the
annotation that ties both money legs to the message they bought.

Three seams connect them, and all three are the SDK's own interfaces:

| Seam | Pointed at |
| --- | --- |
| `WalletAdapter` | Coco, so there is one wallet and one balance |
| `StorageDriver` | `createProfileScopedStorage`, so provider state cannot leak between Nostr accounts |
| `DiscoveryAdapter` | seeded from nagg's lineup, so there is one catalog |

Consequences accepted deliberately:

- **A mint round trip per request.** Chat needs the mint reachable; it did not
  before. The change is banked as the response completes rather than held,
  because a held token is a balance again in everything but name.
- **The admission gate leaves the wallet, not the expected cost.** On a
  frontier model that is thousands of sats against a message costing a
  fraction of one. It returns within the round trip, but it is the user's
  money, so `confirmSpend` shows the figure before it goes and dismissal is a
  decline.
- **The exact cost arrives after the stream, not before it.** Spent minus
  returned is only known once the change is home, so `sendMessage` returns a
  `cost` promise and the message is finalized with it. The promise settles
  whether or not the caller consumes the stream, so an abandoned response never
  abandons the money.
- **Two ledger movements per message.** Grouped by an `ai` annotation, the same
  meta-grouping `swap.groupId` uses, carrying the session and message ids so a
  cost traces to the answer it bought. Because the `WalletAdapter` seam has
  nowhere to thread a caller's context, the context is ambient and its two
  windows — around the request, around the finalize — are opened explicitly.

## Why the SDK, having argued against it

The first revision listed four objections. Three were wrong about the shipped
package and one was right but cheap to answer:

- *A second Nostr stack.* `applesauce-*` only runs inside `ModelManager`, the
  SDK's Nostr discovery. Nothing else reaches it, and the app does not
  construct one: the catalog is seeded from nagg's lineup through
  `DiscoveryAdapter.setCachedModels`. `nostr/` remains the only Nostr transport
  the app runs.
- *Two owners of money-adjacent state.* The SDK's store is namespaced
  (`routstr-sdk:`) on the app's profile-scoped storage and holds only in-flight
  request tokens and provider caches. `routstrStore` keeps the persisted
  product state under this repo's rules. The one durable record — the token
  between paying and being paid back — moved wholesale to the SDK, which chases
  it better: `refundXcashuTokens` maps every routstr refund status, and falls
  back to redeeming the original token when the node never took it.
- *`sendToken` loses the operation handle.* True, and it does not matter: the
  adapter annotates the leg at the point it creates it, where the handle is in
  hand, so nothing has to be recovered from the token afterwards.
- *Its reference consumer is stale.* Irrelevant to the package. 0.4.6's
  `_checkBalance` no longer rejects a funded wallet, which was the bug observed
  in that consumer.

What adopting it deleted here: a hand-written EHBP transport, a Tinfoil
attestation client, a request-payment module, and a pending-payment recovery
sweep — all of which the SDK ships, and none of which this repo wants to own
against a protocol it does not define.

Two accommodations were needed, both recorded where they live:

- Metro resolves dynamic `import()` statically, so the SDK's Node-only
  cache-secret branch has to resolve even though `isNodeLikeRuntime()` can
  never be true here. `os`, `fs` and `path` alias to empty modules; `stream`
  resolves to `readable-stream`; `zlib` resolves to a one-function pako shim
  for the SEV-SNP report. See `metro.config.js`.
- The package is ESM-only in a way Jest cannot transform (`applesauce-relay` →
  `node:crypto`). `moduleNameMapper` points `@routstr/sdk/browser` at a stub
  whose `routeRequest` behaves the way the real one does. It proves the seams
  Sovran owns; the Metro bundles and a funded device run prove the rest.

Still unused, and worth revisiting: the SDK's Nostr provider discovery (kind
38421) and review-gated ranking (38425). nagg answers that question today.

## Validation record — 24 September 2026

Workspace type checks (iOS and Android), app lint at zero errors with the
`no-restricted-globals` budget ratcheted down by one, knip, the styling and
React Compiler ratchets, both Metro bundles, and the app and wallet suites.
Two snapshot suites fail identically on a clean tree and are untouched.

Not yet exercised on device: the mint-and-change round trip under real latency,
and the recovery sweep against a balance actually stranded on a node.
