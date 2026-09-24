# Pay Routstr per request, and do not adopt its SDK wholesale

Status: accepted; device validation of the payment round trip outstanding.

## What forced the decision

Sovran opened a hosted account on one Routstr node: deposit once, spend down a
balance keyed to `sk-<sha256(token)>`, a row in *that node's* database. nagg
moves its node pick on catalog health alone and the app follows, so the key
routinely ended up addressed at a node that never issued it. The 401 that
produced was read as "spent" and the key — the only bearer instrument for the
deposit — was deleted. A routine node change silently ate the balance. It ate
250 sats on 2026-09-24, and the header went on showing them.

## Decision

**Pay per request out of the wallet.** Routstr's `X-Cashu` mode carries a Cashu
token on the request; the node redeems it, does the work, and returns the
change in the response header. Nothing is held on a node between requests, so
nothing can be stranded and switching provider costs the user nothing. The
Sovran wallet is the only balance there is.

Consequences accepted deliberately:

- **A mint round trip per request.** Chat needs the mint reachable; it did not
  before. The change token is banked immediately rather than held, because a
  held token is a balance again in everything but name.
- **The admission gate leaves the wallet, not the expected cost.** On a
  frontier model that is thousands of sats against a message costing a
  fraction of one. It returns within the round trip, but it is the user's
  money, so `confirmSpend` shows the figure before it goes and dismissal is a
  decline.
- **A window between paying and being paid back.** Closed by recording the
  token before it leaves: routstr's refund endpoint takes the ORIGINAL token in
  `X-Cashu` and returns that request's change, so a payment can always be asked
  about again. Its four answers are distinct and all load-bearing — 200 bank,
  404 never redeemed so undo the send, 425 still running so retry, 410 swept.
- **Two ledger movements per message.** Grouped by an `ai` annotation, the same
  meta-grouping `swap.groupId` uses, carrying the session and message ids so a
  cost traces to the answer it bought.

## On `@routstr/sdk`

Upstream maintainers suggest it, and had it been adopted at the start it would
have saved real work: its `XCashuTokenEntry` is the same recovery record we
arrived at independently, and its `nodeGateSats` is the gate maths we ported.
Its `WalletAdapter` is four methods Coco already satisfies, so a second Cashu
wallet is not implied.

It is still not adopted, for reasons that are about this repo rather than its
quality:

- `applesauce-core` / `applesauce-relay` / `applesauce-sqlite` / `rxjs` is a
  second Nostr stack beside `nostr/`, whose tiered transport is documented and
  owned here.
- Its `StorageAdapter` wants provider, key and token state that now lives in
  `routstrStore` under this repo's persistence rules — tolerant schemas,
  balance-aware trims, drift snapshots. Two owners of money-adjacent state is
  the failure this change exists to end.
- `WalletAdapter.sendToken` returns a token string and no operation handle, so
  reclaiming an unspent send and annotating its ledger leg both need a
  side-channel map we would maintain regardless.
- Its own reference consumer pins two minors behind and is four months stale
  against routstr-core, which we read directly instead.

Revisit for Nostr-based provider discovery (kind 38421) and review-gated
ranking (38425): that is substantial code we have not written and do not want
to.

## Validation record — 24 September 2026

Workspace type checks (iOS and Android), app lint at zero errors, knip, the
styling ratchet, both Metro bundles, and the app and wallet suites. Two
snapshot suites fail identically on a clean tree and are untouched.

Not yet exercised on device: the mint-and-change round trip under real latency,
and the recovery sweep against a balance actually stranded on a node.
