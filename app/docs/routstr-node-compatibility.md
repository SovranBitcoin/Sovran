# Routstr node compatibility and failure modes

What the network actually does when Sovran pays a Routstr node per request
(`X-Cashu`), by node version, and what the client does about it. Compiled
2026-09-26 from `app/log.txt`, routstr-core / @routstr/sdk source, the live
`/v1/info` of the nodes tested that day, and a sweep of every issue and PR in
Routstr/routstr-core, routstr-sdk, routstr-chat, routstrd and protocol from the
preceding twelve months (none of the five repos has Discussions enabled).

Versions at the time of writing: routstr-core **v0.4.7** (2026-09-07), `main`
40+ merged PRs ahead and untagged; @routstr/sdk **0.4.6**; routstrd 0.4.11.

## The strategic signal

The SDK maintainer de-prioritised X-Cashu mode on 2026-07-28 when closing the
two xcashu hardening PRs (routstr-sdk #31, #32): "xcashu mode increases txns by
~10x and we're already being rate limited … hardening xcashu paths is
premature work." routstrd runs in `apikeys/lazyrefund` mode and every recent
SDK money-path change targets that mode. Core's X-Cashu path still receives
fixes; the client side is unowned. **In X-Cashu mode Sovran owns refund
sweeping, disconnect recovery and failover policy.** None of it will arrive
from the SDK.

## Where the client stands against each finding

| Finding | Source | Sovran |
| --- | --- | --- |
| Nodes < 0.4.5 cannot expand short (8-byte) V4 keyset ids; Minibits' active keyset is version-1. 400 "Keyset … not known" with DLEQ, 500 `internal_error` without. | core #663, sdk #58, routstrd #68; seen on blazelight 0.4.3 and orangesync 0.4.4 | Done. V3 token with full ids when any proof carries a v1 id (`shared/lib/routstr/tokenWire.ts`). |
| Every released node ≤ 0.4.7 rejects tokens spanning more than one keyset. A 0.4.7 node's own change can be multi-keyset. | core #732 (merged, unreleased) | Logged only (`routstr.sdk.token_multi_keyset`). Coco's coin selection is not keyset-aware. Receiving multi-keyset change into the wallet is a wallet op and works. |
| Upstream 404 for a model the catalog lists is forwarded as `upstream_error` under 404 with a full refund. | core #554; six of eight failures on 2026-09-26 | Done. The refusal is recovered from the SDK log line, the walk moves to the next model, and the model is remembered as unavailable on that node for 30 minutes. |
| Node catalogs list deprecated models; Routstr manages the current set on Nostr (kind 38423, `d: routstr-21-models`, signed by `4ad6fa2d…eacc8`). The maintainers' own answer to the privateprovider 404s: `tinfoil-deepseek-v4-flash` is deprecated. SDK 0.4.6 fetches the list but applies it to nothing. | maintainers, 2026-09-26; SDK source | Done, both sides. The app fetches the list over its own Nostr stack (`shared/lib/routstr/curatedModels.ts`) and nagg over its relays (`internal/appview/curated_models.go`). Rule in both: a vendor with at least one listed qualifying model builds its ladder from listed models only; a vendor with none keeps its full set. Ids compared normalised (dots, case, vendor prefix). |
| X-Cashu responses are fully buffered: first byte after the whole generation plus a mint round trip. iOS abandons a silent request at 60 s. | core #281/#269; chat #163 | Done. Native module raises the idle timeout to 300 s (`app/modules/network-timeouts`); JS deadlines are 120 s to first byte, 60 s between chunks. |
| A fully consumed token gets no `X-Cashu` header and no refund row; asking about it answers 425 forever. | core #180 and source | Done. Settled when `X-Routstr-Cost-Msats` covers the token. |
| 425 = change still being minted (`Retry-After: 2`), 404 = no payment row (or pending on nodes < 0.4.4), 410 = swept. Sweep window is 7 days on 0.4.2–0.4.5, 180 days from 0.4.6. | core #590, #591, #433 | Done. Fresh tokens are re-asked on a 20 s / 1 / 3 / 10 min schedule; stale ones once per session; 404 re-receives the original token and keeps it if the mint refuses. Never deleted. 410 not yet special-cased (treated as refused, token kept). |
| A transport exception on the node after redemption mints no refund: 425 forever. Only the operator can reconcile. | source (no issue) | Bounded by the session dedupe. `x-routstr-request-id` is logged on every SDK error line for operator contact. |
| The node's error taxonomy (`token_already_spent`, `invalid_token`, `untrusted_mint`, `mint_error` 422, `mint_unreachable`/`mint_timeout`/`mint_rate_limited` 503, `cashu_error`, `token_consumed` 500, `api_error` 500). Only the 503s are retryable. | core #578 | Done. `isPaymentLayerFailure` stops the model walk on all of them. |
| Nodes cache terminal redemption failures per token for 24 h; polling `/v1/wallet/info` with a token redeems it. | core #672, #674 | Never done by the app. |
| Nodes ≥ 0.4.7 reject tokens from mints not in `/v1/info.mints` before redemption; < 0.4.7 swapped cross-mint with fee loss. | core #712, #408, #418 | Done. The paying mint is chosen from the node's list, spelled as the wallet spells it. |
| Fee-charging mints (Cuba 100 ppk, Mountain Lake 250 ppk) can redeem a 1-sat or many-proof token to zero (`cashu_token_zero_value`, token consumed). | core #556, #379, #638 | Not handled. Minibits charges no fee; revisit if another mint becomes the paying mint. |
| EHBP (Tinfoil) path on ≤ 0.4.7 has a 30 s inactivity timeout surfacing as a bare 500 with no refund; 600 s with refund after #700/#749. EHBP bodies are sealed so the node reserves full `max_cost` regardless of `max_tokens`. | core #700, #749, #669 (open) | Known. The reservation is already priced at the ceiling for sealed models. Long sealed generations on 0.4.7 nodes are a risk until nodes upgrade. |
| Upstream 5xx / timeout becomes **424** `UPSTREAM_UNAVAILABLE` / `UPSTREAM_TIMEOUT` with `X-Routstr-Error-Scope: upstream` and a refund; 429 `UPSTREAM_RATE_LIMIT`. SDK 0.4.6 has no 424 case and cools the whole node for 210 s. | core #771, #765 (merged, unreleased) | Done. 424 is read as the whole upstream being down: skip siblings on that upstream, keep the node. |
| A provider that omits `usage` used to keep the whole prepayment; now estimated or refunded. | core #715 (unreleased) | Nothing to do; cost header is read when present. |
| Node's SSE replay uses single `\n` and may carry non-JSON `data:` lines. | core #537, #543, #582 | Parser skips non-JSON lines. |
| 402 in X-Cashu mode is `detail.type = minimum_balance_required` with `amount_required_msat`, no `error` object; upstream 402s are `upstream_error`. | core source, sdk #37 | Type is recognised as a wallet 402. `amount_required_msat` is not yet read back to re-mint exactly (no 402s observed; follow-up). |
| Nodes ≤ 0.4.7 discount the reservation only for `max_tokens` (and `max_output_tokens`); `max_completion_tokens` alone reserves the ceiling. Rollout gated on ~95 % node adoption. | sdk #53, routstrd #93 (open) | Done. `max_tokens` is sent, never `max_completion_tokens`. |
| Cross-provider failover minted 19 tokens for one request (463k sats) in production; the SDK's failed-provider exclusion is still commented out. | sdk #46 (open) | Not exposed: Sovran pins one node, so the SDK walk is one node long; the in-app model walk is capped at three paid attempts. |
| The SDK never runs its own xcashu refund sweep; its sweep helper deletes a token after three 404s. | sdk source | Sovran runs its own sweep (launch, foreground, after every failure or abort) and never deletes on 404. |
| `isNetworkErrorMessage` is a substring allowlist; React Native spellings were missing. | sdk #41, #32 | Patched in `app/patches/@routstr+sdk+0.4.6.patch`. |
| Tinfoil key-config 422 must trigger re-attestation. | core #714, sdk #52 | SDK ≥ 0.4.4 in use. |
| Nodes want `X-Title` / `HTTP-Referer` for traffic attribution. | core #675 | Not possible: the SDK builds request headers itself and discards caller headers. Follow-up if the SDK grows a header option. |
| Discovery can legitimately yield zero enabled providers on a fresh install (review gate fails closed; relay flooding). | sdk #47, #59 | Sovran discovers through nagg, not the SDK's relay pool. |

## Behaviour to keep in mind

- **Closing the app mid-answer.** The node finishes the request, charges what
  the answer cost, and parks the change in its refund row. There is no way to
  retrieve the answer: a node stores nothing per request that a client can
  read back. The client recovers the money on the next launch, foreground or
  sweep, and the empty turn says so (`routstr.interrupted`).
- **Stopping a request.** Same as above: an abort throws before any SDK
  recovery, the token is journalled, and the recovery schedule collects it.
- **Which node version a failure came from** is on every
  `api.routstr.chat.failed` line as `nodeVersion`. Nodes older than 0.4.5
  should be avoided for anything but plaintext, sat-unit, Minibits payments.

## Unreleased node changes that will change what the client sees

Merged to routstr-core `main` after v0.4.7 and not yet tagged: 424 upstream
attribution and same-upstream 5xx retry (#771, #765); multi-keyset tokens
(#732); EHBP timeout 600 s with refund (#700, #749); key-config 422
passthrough (#714); usage estimation and full refund when usage is missing
(#715); partial-stream billing (#769); reservation honouring
`max_completion_tokens` and pricing images and tools (#680, deposits go up);
Lightning refunds with 409/502/503 semantics on the bearer refund endpoint
(#729); provider-less model paths and `x-routstr-model-path` pinning that
disables node-side failover (#748, #720); default trusted mints Minibits and
Cuba (#754); `X-Title` attribution in logs (#675); admin request-id lookup
(#735, operator only).

Open and worth watching: core #669 (`X-Routstr-Max-Tokens` for sealed bodies),
#562 (durable refund idempotency); sdk #62 (model-scoped cooldown), #46
(failover depth cap), #57 (persist-before-dispatch, `failover:false`), #29
(Node-free browser entry, which is why the SDK cannot be imported under Jest).

## Maintainers' recommendations to clients (docs/api/errors.md on `main`)

1. Branch on `error.type` / `error.code`, never on message text. Retry only
   `mint_unreachable`, `mint_rate_limited`, `mint_timeout` with backoff.
   `token_consumed` is spent and uncredited: do not retry.
2. On an X-Cashu error, receive the token echoed in the `X-Cashu` response
   header (present only while still spendable); on an upstream failure read
   `error.refund_token`.
3. `POST /v1/wallet/refund` with `X-Cashu: <original token>`: 404 no matching
   request, 425 retry after `Retry-After`, 410 swept.
4. 424 is "node healthy, upstream failed": retry or change model, do not mark
   the node down. Their sample retry set is `[424, 429, 502, 503, 504]`.
5. Pay only from the node's configured mints.
6. Never poll `GET /v1/wallet/info` with a fresh token.
7. Keep client timeouts above worst-case upstream latency.
8. Keep Cashu tokens out of URLs; inspect change with `getTokenMetadata`.
