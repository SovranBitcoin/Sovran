# Sovran test implementation roadmap

This is the durable worklist behind `testing-strategy.md`. It combines the
Cashu reference-wallet gap survey, the whole-app robustness audit, the
state-machine audit, component snapshots, and deterministic device testing.

Legend: `[x]` implemented in the current testing expansion; `[ ]` remains.
Items are ordered by funds/security blast radius before presentation polish.

## 0. Harness and deterministic fixtures

- [x] Add Testing Library for new React Native component/hook tests.
- [x] Add `fast-check` to the app package; retain the wallet property runner.
- [x] Build one Design System scenario catalog shared by screens and tests.
- [x] Canonicalize renderer output and snapshot meaningful exact structure.
- [x] Snapshot the complete reusable-component inventory as covered/pending.
- [x] Add a dedicated `test:design-system` command and require two clean runs.
- [x] Place `serve-sim` behind loopback-only `sim:*` scripts as the QR/camera
      sidecar; validate its non-payable fixture manifest.
- [x] Give the existing WDA/cocod DSL an isolated cocod child HOME/socket/pid
      through `SOVRAN_TEST_COCOD_HOME`.
- [ ] Add a run ledger, development-bundle reinstall/reset coordinator, funding
      budget, sweep/reconcile step, and failed-sweep quarantine.
- [ ] Install and doctor `agent-device`, then record the first Design System
      replay with accessibility snapshot, screenshot, video, logs, and artifacts.
- [ ] Add scoped Stryker audits for funds-critical pure modules; do not make the
      mutation score a merge gate until baselines are understood.

## 1. Cashu funds-safety invariants

- [x] Fee-aware selection: raw Sovran delegation, installed coco convergence,
      mixed-fee keysets, reserved/inflight exclusion, and insufficient-funds exit.
- [x] DLEQ receive boundary: valid, missing fields/keyset/amount key, tampered
      `e/s/r/C/secret`, and one-invalid-of-many rejection for offline receive.
- [ ] Restore returns proofs with complete receiver-verifiable DLEQ material.
- [x] NUT-08 installed contract: durable prepare before execute, JSON-safe blank
      persistence, counter/blank-count table, and deferred PAID short no-DLEQ
      positional recovery from modern `changeOutputData`.
- [ ] Upstream coco/cashu-ts gap: shuffled or same-denomination DLEQ re-pairing,
      unmatched-output reporting, and recovery error flag. Current APIs are purely
      positional; fix/expose upstream rather than copy recovery crypto into Sovran.
- [ ] Stale melt-quote clear before replacement. Legacy cashu.me melt-output
      fields are not part of Sovran's coco-v2 durable contract.
- [x] NUT-13 durable counter monotonicity: MAX-on-conflict repository wrapper,
      per-mint/keyset serialized writes, transaction-scope guard, stale migration
      readback/validation, too-high retention, and keyset independence.
- [ ] Upstream coco gap: proof+counter atomicity, distinct concurrent derivation
      allocation, and outputs-already-signed skip/bump. Current counter increment is
      read-modify-write outside a repository transaction.
- [ ] Archive old mnemonic counters before seed rotation.
- [x] NUT-09 installed restore walk: generated N-empty-batch stop, contiguous and
      two-batch-gap recovery, exact high-water, v2 keyset delegation, SPENT filtering,
      and remaining-balance assertion.
- [ ] Upstream coco cleanup: rename/reorder the reversed restore gap/batch
      constants, expose scan results, and fix the counter-zero falsy edge. Restore
      counter+proof atomicity is covered by the counter-service upstream item.
- [ ] Invalid mnemonic import when Sovran exposes a manual seed-import field.
- [ ] Deterministic-secret v1 BIP32 and v2 HMAC spec vectors at the dependency
      boundary, including unknown-version rejection.
- [ ] Proof reservation: atomic open/commit/rollback, original state and tx id,
      orphan-PENDING recovery, two-table commit, duplicate/race guards, and lost
      response idempotency ledgers.

## 2. Cashu input and interoperability boundaries

- [x] Token V3/V4 golden decode; padded/unpadded input; unsupported and garbage
      rejection; duplicate-secret guards at metadata and mesh boundaries;
      unresolved short-v2-keyset mesh rejection; semantic V3-to-V4 redeem
      upgrade; and ancient base64-keyset V3 fallback.
- [ ] Upstream cashu-ts token gaps: no public V3 encoder, duplicate secrets are
      still summed internally, and short v2 ids require a full keyset-id lookup.
      Sovran rejects the exposed unsafe boundaries; retain DLEQ in future token
      re-encoding coverage when the dependency exposes the needed codec surface.
- [ ] Unified payment-string matrix: Cashu, bolt11/12, LN address, LNURL,
      creqA/CREQB1, BIP-321, pubkey, mint URL, wrapper/separator stripping, and
      per-screen supported-type allowlist.
- [ ] BIP-321 resolution: `creq > lightning > onchain`, uppercase query keys,
      required-parameter failure, and explicit unsupported-rail messages.
- [ ] LNURL/LN-address pure matrix: bech32, schemes, onion http, well-known
      endpoint, and metadata identifier extraction.
- [ ] Mint URL identity: trailing slash, host case, default port, path-case
      significance, idempotence, token equality, and payment-request mint matching.
- [ ] Multi-mint balance: multiple keysets per mint, empty mint zero, global
      rollup, and decoded-token distribution by normalized URL.
- [ ] Mint capability routing: NUT-04 vs NUT-05, method+unit match, no-method
      behavior, and no-capable-mint reason codes.
- [ ] Trusted-mint warning branch for string/object lists and empty input.
- [x] NUT-18 `creqA` CBOR round-trip, transport/unit/mints, and embedded NUT-10
      P2PK/HTLC lock preservation.
- [x] NUT-26 `CREQB1` bech32m spec vector and strict checksum, mixed-case, HRP,
      malformed-tag, short-amount, and NUT-18/NUT-26 dispatch tests.
- [ ] Upgrade cashu-ts before claiming NUT-26 embedded NUT-10 lock safety: 4.5.1
      encodes the lock but drops it during CREQB1 decode.
- [ ] P2PK condition construction/filtering/sigflag, signature dedupe, SIG_ALL,
      multisig/refund/locktime/impossible thresholds, and malformed-condition parse.
- [ ] HTLC preimage/hash/refund matrix only when Sovran ships HTLC ecash.

## 3. Colada state machine and money-flow contracts

- [x] Distinct scans are accepted after an option sheet; identical scan payloads
      remain deduplicated.
- [x] Irreversible commit ownership is generation-scoped, so an old `finally`
      cannot unlock a newer money-moving operation.
- [x] A stale confirm-send result cannot merge context into the replacement flow.
- [x] Reset clears scan dedupe and scan-source attribution.
- [x] Every audited app send/deep-link root clears stale Routstr/contact/Nut Drop
      routing context before starting Colada; amount draft clearing is pinned.
- [ ] Remove remaining in-place `flowCtx` mutations and property-test context
      identity changes for source/options/failures.
- [ ] Refresh cached snapshots inside reset and ownership-scope same-unit
      provider overrides.
- [ ] Extend model commands to on-chain melt, payment-request receive, Nut Drop,
      scan, confirmMelt, and confirmPaymentRequest.
- [ ] Model two concurrent proof operations and assert no cross-flow context leak,
      no send-lock bypass, bounded context, and exhaustive legal state partitions.
- [ ] Exhaustive transaction status guards: terminal/inflight mutually exclusive
      and complete, rollbackable subset, new-enum-value fixture tripwire.

## 4. Persistence, profile isolation, and durable data

- [x] Direct merge contract: valid merge/action preservation, invalid blob
      returns current state, non-object defense, and one rejection log.
- [x] Expand persisted schema drift coverage from 7 to the durable store set.
- [x] Local degradation for Nut Drop queue status, mint distribution values,
      profile source, and swap group/leg/index values.
- [x] Profile-scoped storage changes keys on profile switch, preserves bootstrap
      behavior, and respects skipped writes.
- [ ] Per-entry degradation for transaction location/distribution,
      send-reachability, own-content, annotations, search history, wallet lifecycle,
      and every remaining strict record/array value.
- [ ] NPC mint v1-to-v2 migration: first non-empty, empty, and already-v2.
- [ ] Migration round-trip fixture for every persist version; fuzz one corrupt or
      unknown field and prove unrelated durable fields survive.
- [ ] Property-test profile switches: proofs, keys, history, stores, and DMs never
      cross account scope.

## 5. Security, identity, and privacy

- [x] Mnemonic validation/no-write, corrupt-read refuse-overwrite, coalesced
      SecureStore reads, 64-byte Cashu-seed self-heal, key-builder guards, and
      delete-all union/index ordering.
- [x] NIP-17 recipient/self-copy real-crypto round trip, throwaway wrapper keys,
      wrong-recipient rejection, seal signature, rumor hash, author match, and kind.
- [x] Logger field-name redaction for short private keys and byte-array seeds;
      retain specific value-derived secret brands.
- [ ] Mock-contact allowlist/fixture isolation, pubkey-to-account-number bounds,
      and SecureStore probe-key completeness.
- [ ] Run Wycheproof only at Sovran-owned cryptographic seams; dependency crypto
      stays covered by its upstream vectors.

## 6. Payment, amount, history, and formatting logic

- [x] History normalization MINT matrix, unknown-state identity, numeric object
      amount serialization, array reference stability, and idempotence.
- [x] Melt-target classification and cross-call memo regression.
- [x] `composeSatoshis` cross-algorithm subset-sum equivalence and reachable
      nearest-bound properties across size thresholds.
- [x] App currency formatting: cents vs sats, display modes, unknown units, and
      generated integer-sat no-decimal invariant.
- [ ] Balance breakdown garbage/object amount NaN safety.
- [ ] Least-strict mint amount-bound reason and randomized envelope property.
- [ ] Fiat resolver/suggestions, minor-unit integer round-trip, send-all, and
      offline composability bounds.
- [ ] Unit conversions and safe-sat conversion edge matrix.
- [ ] Amountless invoice and paid amount zero finalization.
- [ ] Custom Cashu unit, signed sat prefix, keypad leading-zero/pluralization,
      URL display truncation, and bolt11 msat-to-sat/time-left formatting.
- [ ] Timeline-array approval snapshots for every rail/state; avoid full-screen
      snapshots whose noise obscures the contract.

## 7. Async hooks, polling, and concurrency

- [x] Single-flight and keyed single-flight duplicate, rejection-release, and
      per-key parallelism.
- [x] On-chain melt quote: cadence, PAID stop, error retention, stale quote id,
      falsy clear, and unmount suppression.
- [x] Mempool tx confirmations: cadence continues after `confirmed`, error
      recovery, normalization/change, stale response, and unmount.
- [x] Nostr tier health: run generation/abort, blur/unmount, no online flicker,
      and disabled-tier exclusion.
- [ ] Mempool address summary overlapping refresh count, abort vs real error,
      cache/loading distinction, and interval bypass.
- [ ] Nostr profile bounded retry/backoff and per-pubkey attempt lifetime.
- [ ] Relay health, swap listener edges, rollback timer, mint-info stale write,
      version-check abort, and deferred-mount cancellation.
- [ ] Offline invoice poller: network-error cooldown, normal unpaid polling,
      requeue preservation, cooldown skip, and TTL exact expiry.

## 8. Nostr, feed, media, and AI boundaries

- [ ] Relay notification demux anti-spoof matrix, reason/scope filters, and dedupe.
- [ ] Untrusted event coercion, ancestor cycle termination, thread/own-history
      demux, kind-0 parsing, repost alias resolution, and NIP-10 root/reason rules.
- [ ] Feed content parser ordering/overlap/media/query/invalid-note/size guard;
      normalize/reference-id/url helpers.
- [ ] Ranking intent: exact engagement metrics/weights/transforms/kind limits,
      follower score injection, and viewer boost.
- [x] Owned Blossom deletion state sequence, ambiguous failure HEAD recovery,
      present/unknown failure, and sign-failure no-probe.
- [ ] Blossom upload signing, response, timeout/retry, abort, preflight, and media
      descriptor merge.
- [ ] Routstr retry/model-rejection status classification, affordability fail-open,
      deficit rounding, display name, and outgoing `max_tokens` request body.

## 9. Native transport and untrusted input

- [x] NFC NDEF short/normal boundary, declared-length bounds, type, language
      length, UTF-8/UTF-16, and overlong-language rejection.
- [x] NFC Type-4 write order: zero NLEN, contiguous chunks, final NLEN last, and
      stage-specific failure stop.
- [x] Bearer downgrade consent resolves true only on explicit send; cancel,
      dismiss, and callback race fail closed.
- [x] Deep-link route schema matrix for HTTPS, compressed pubkey, npub, geohash,
      and BLE hex ids.
- [ ] APDU offset/status/response/error mapping and token-writer AID/NDEF select,
      cancel passthrough, and generic error wrapping.
- [ ] Nut Drop auto-redeem P2PK gate and missing-mint/own/null-key branches.
- [ ] BLE UTF-8 chunk boundary/newline reconstruction, geohash vectors, embedded
      token extraction, creq diagnostics, and peer identity/avatar precedence.
- [ ] neverthrow boundaries for safe hostname, JSON parse, and external URL open.

## 10. UI, themes, navigation, and exact presentation

- [x] Deterministic Empty State, Loading Indicator, and Foundations scenario
      families with stable device selectors and exact snapshots.
- [x] Catalog and snapshot segmented progress, exhaustive checkpoint mapping,
      transfer chains, and real payment timeline outcomes.
- [x] Catalog deterministic skeleton/content parity, image pending/fallback, and
      visible/hidden/stuck fade-stress diagnostics.
- [x] Catalog wallet controls: amount modes/direction, keypads, action segments,
      circle actions, mint identity, copyable values, selection squares, detail
      expansion, and transfer feedback.
- [ ] Use device screenshots/pixel assertions for UI-thread mid-fades, decoded
      native-image output, and paint-level blank-with-progress races.
- [ ] Catalog and snapshot status toasts, payment rows, forms, lists, headers,
      popups, media, feed/chat, map, AI, theme, and transaction components in
      bounded batches.
- [ ] Wallpaper cover generation/timer, capability dispatch flat floor, theme
      draft commit ordering, album grouping, header width clamp, motion refcount,
      amount decoration, first-render count animation, and provider guards.
- [ ] Relative date boundaries/rollovers, compact numbers, middle truncation,
      popup segment formatting, URL normalization contrast, and payment-context root
      clear across every future entry.
- [ ] Migrate the remaining component tests from deprecated
      `react-test-renderer` to Testing Library behavior assertions.

## Completion gates per slice

1. Demonstrate red first for a claimed bug or state why the implementation
   already satisfied the new contract.
2. Run the focused suite twice; snapshots must be unchanged on run two.
3. Run app/wallet type-check as applicable, touched Prettier and ESLint, and
   `git diff --check`.
4. For funds movement, state whether the test exercises Sovran logic, the
   Sovran-to-coco contract, or an installed upstream implementation.
5. Never commit live payment material, mnemonics, private keys, or funded-wallet
   state as a fixture.
