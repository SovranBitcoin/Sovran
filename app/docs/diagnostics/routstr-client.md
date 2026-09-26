# Routstr client diagnosis

Task N5 uses nagg's `/app/ai-lineup` as the node and model authority. No community
node is embedded in the app. The only built-in default remains
`https://api.routstr.com/v1`.

## Operator checklist (manual, not run by this task)

Use a tiny disposable **test-mint** token accepted by the node. Keep credentials,
returned `x-cashu`, and any `/wallet/info` `api_key` out of terminal history,
shared captures, and application logs. Use the returned change token for the next
request; do not replay its spent predecessor. Use separate fresh test tokens when
comparing auth modes if a prior request did not return usable change.

1. Check `GET https://api.routstr.com/v1/models` and the configured nagg's
   `/app/ai-lineup`. Record status only and whether `node.baseUrl` differs from the
   public default. If the public node still returns route-level 404s, record that
   result; repeat the completion checks against the active origin from nagg.
   Do not add that origin to app source.
2. Choose an enabled model returned by the active node or lineup. POST
   `/v1/chat/completions` with JSON
   `{"model":"<selected-id>","messages":[{"role":"user","content":"Reply OK"}],"max_tokens":8,"stream":false}`.
   Send `Authorization: Bearer <test-token>` and `Content-Type: application/json`.
   Verify non-stream content, status, and the presence of change/cost headers.
3. Repeat with `stream:true`. Verify initial response headers carry `x-cashu`
   when change is returned, then valid SSE chunks and `[DONE]`. Check
   `x-routstr-cost-msats`, `x-routstr-input-cost-msats`,
   `x-routstr-output-cost-msats`, and `x-routstr-request-id` when present.
   Missing optional cost headers alone are not a failed completion.
4. Repeat both non-stream and stream requests with `X-Cashu: <test-token>` and
   **no Authorization header**. The app uses this mode only when nagg supplies
   `node.authMode: "x-cashu"`; an `sk-` key always remains Bearer.
5. GET `/v1/wallet/info` with the current Bearer credential. Verify balance units
   are msats; privately retain any returned `api_key`/change. A returned `sk-` key
   must never be replaced by a later change-token header.
6. Force a 402 using insufficient disposable test credit and a valid model with
   a reservation above that credit. Expect `detail.reason` and
   `detail.amount_required_msat`; `detail.balance_msat` is optional. Verify the
   app preserves its balance when available balance is omitted, and uses an
   explicit available value (including zero) when supplied. Older string errors
   containing required/available mSats remain supported.
7. Exercise node recovery in a controlled test setup: route-level 404, network
   failure, or 5xx causes an immediate nagg refresh, at most once per five minutes.
   A changed node gets one retry with its refreshed Auto model. An unchanged
   failed node stops; a started stream is never replayed. A rejected model id
   invalidates the live lineup while retaining the offline snapshot.
8. With mocked device time, confirm fresh lineup foregrounds skip fetches, a
   lineup older than 24 hours refreshes, and failed refresh after seven days
   permits catalog derivation. Cold-start offline and verify the saved node is
   used. Simulator/device checks were intentionally not run by the implementation.

## Log evidence

- `api.routstr.http_error`: status, type, code, the node's `x-routstr-request-id`,
  numeric required/available msats, and the parsed message (capped at 200 chars
  and passed through the logger's secret redaction). The message used to be
  excluded, which made a 402 the node forwarded from the AI provider
  indistinguishable from one routstr raised about the key's balance — every send
  then reported "Insufficient balance" on a funded wallet. It is a log, not
  user-facing copy; `describeError` still owns what the user sees.
- `ai.send.provider_declined`: a 402 carrying none of routstr's wallet markers,
  i.e. the AI provider behind this model refused. `declinedUpstream` names the
  upstream account (nagg's `upstreamId`, absent on nodes too old to report it)
  and `skippedSameUpstream` counts the candidates jumped over because they sit
  behind it. The walk is capped at `MAX_DECLINED_ATTEMPTS`. One node fronts
  several upstream accounts and they fail independently — a node whose credit
  with one is exhausted answers 402 for every model behind it while its
  catalog, wallet and other upstreams stay healthy.
- `routstr.e2ee.attested`: an enclave was verified, with how long it took and a
  measurement prefix. The measurement identifies the CODE the enclave runs, not
  the user, and it is what makes "which enclave answered" answerable later.
- `routstr.e2ee.attestation_failed` / `routstr.e2ee.key_rotated`: verification
  refused, or the enclave rejected our key configuration (422 problem+json) and
  the send re-attested once.
- `api.routstr.chat.start` / `.response_received` / `.stream_started` carry
  `sealed`, which is true only when the model id begins `tinfoil-`. That prefix
  is the ONLY sound test for end-to-end encryption: the live catalog lists
  `glm-5-3` and `tinfoil-glm-5-3` at identical prices under the identical name
  "Private (E2EE) GLM 5.3", and only the prefixed one travels sealed.
- `routstr.change_token.applied`: change adopted, with no token contents.
- `routstr.auth.kept_key`: ambiguous 401 retained the current credential.
- `api.routstr.api_key_expired`: explicit invalid/expired/spent/unknown/revoked key.
- `routstr.lineup.refresh_failed`: nagg refresh failed (warn).
- `ai.lineup.server_applied`: lineup applied; `nodeChanged` reports repointing
  without logging the origin.
- `ai.send.request`, `ai.send.lineup_retry`, `ai.send.candidate_failed`,
  `ai.send.failed`, `ai.send.actual_cost`, and `ai.stream.complete`: correlate the
  attempt, bounded recovery, completion, and balance-difference estimate.

The unavailable-provider popup comes from the shared Routstr error catalog:
“The AI provider is unreachable right now. Try again in a minute.”

## Persistence and remaining system work

`authMode` defaults/catches to `bearer`. Optional `lastKnownLineup.nodeBaseUrl`
and the tolerant store `serverLineupAt` preserve older snapshots and malformed
metadata without discarding credentials or sessions. The existing top-level
`nodeBaseUrl` is retained for compatibility. Persisting timestamp invalidation prevents a rejected lineup becoming fresh again after restart. The `persistSchemaDrift` snapshot
was deliberately blessed for these additive fields, with populated round-trip
and enum/resilience regressions.

Follow-up F05 (critical-store recovery after whole-blob merge rejection) remains
out of scope. These tolerant additions do not solve that broader recovery policy.
