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
- [x] Decide the cocod boundary: deliberately acknowledge the current low-value
      `~/.cocod` wallet, pin one absolute binary and version `0.0.16`, require
      `UNLOCKED`, record metadata, and never invoke secret-printing `history`.
      This is explicit non-isolation, not a `HOME` remapping claim.
- [x] Approve the funded-device risk boundary: independent destructive-reset and
      test-fund-loss gates, fresh ephemeral simulator, typed counterparty effects,
      mode-`0600` seed/P2PK custody, exact reconciliation, and crash-aware recovery.
- [ ] Install and doctor `agent-device`, then record the first Design System
      replay with accessibility snapshot, screenshot, video, logs, and artifacts.
- [ ] Add scoped Stryker audits for funds-critical pure modules; do not make the
      mutation score a merge gate until baselines are understood.

## 0b. JSON-native functional definitions and offline harness (`app/e2e/`)

Direction + ownership: [`testing-json-native-adr.md`](./testing-json-native-adr.md),
[`testing-coverage-ledger.md`](./testing-coverage-ledger.md). Simulator-lane JSON
can execute after destructive-reset approval. Ordinary-simulator suite refs
explicitly declare `newInstance`: `true` opens a fresh owned simulator group and
immediately following `false` refs reuse it. Selecting a reused scenario includes
the prerequisite prefix from that group; only order inside such a group is
correctness state. The group cleans its simulator, Metro, and serve-sim resources
without selecting or reusing an existing device. Funded scenarios always start
fresh and additionally require explicit fund-loss acceptance; scenario deferrals
and live verification still gate promotion. Generic live and physical execution
remains disabled.

- [x] Phase-Zero fund reconciliation: verify the two historical ledger seeds hold
      zero at all recorded + default mints (app-faithful derivation, unreachable =
      unresolved, never a false zero); preserve the sim. The historical process
      recorded in `e2e/PHASE-ZERO-RECONCILIATION.md` was stopped, but a later
      orphan process on port 8082 was later observed and was never adopted or
      targeted by the new per-run lifecycle. Startup migration now reports zero
      generic legacy/ledger blockers. One Minibits asset remains explicitly
      deferred because its external TLS endpoint is unavailable; its 13 seed
      custodians and combined custodian remain retained, never misreported as
      zero. Exact Sovran-mint runs can proceed without discarding that custody.
- [x] Source-backed coverage audit (estate recount, `.sov` corpus, wallet state
      machine, cocod capability surface, funded-integration hazard).
- [x] Complete layered coverage contract for every shipped flow in
      `wallet/docs/STATE_MACHINE.md` section 5 and every `shipped` / `partial` /
      `gap` item in section 11. Each row now names its wallet Vitest, app Jest,
      JSON simulator/funded, physical, blocked, or deferred owner in
      `testing-coverage-ledger.md`.
- [x] Strict versioned schema + validator + compact-format check + secret scan;
      `bun run e2e:validate` gate; `.prettierignore` scoped to the exact test-JSON
      globs.
- [x] Typed secrets + redaction (`e2e/core/redact.ts`) — `Secret` handles +
      `redactString`/`redactDeep`; tests cover representative secret patterns,
      nested values, event emission, and reporter output.
- [x] Structured `RunnerEvent` model (`e2e/core/events.ts`, redacts on emit) +
      TTY / plain / JSONL reporters (`e2e/reporting/`) with tests for append-only
      output, ASCII fallback, narrow widths, failure→cleanup, and redaction. JUnit
      remains future work.
- [x] Build the durable `e2e/ledger/` coordinator: exact asset intent, outflow,
      sweep, conservation, crash-window quarantine, and cross-instance effect
      leases retained after uncertain outcomes.
- [x] Add the approved current-cocod boundary: explicit wallet acknowledgement,
      absolute binary selection, version-`0.0.16` allowlist, capability probing,
      `UNLOCKED` preflight, typed process execution, and a hard ban on `history`.
- [x] **Fixed the funded-integration hazard**: `integration/` is now an opt-in
      LIVE lane where needed (`vitest.config.ts` excludes the three live-mint
      files from the default gate); `setup.ts` refuses a public-mint default
      (`requireLiveMint`); `fundWallet` throws instead of returning silent-false;
      removed every `if(!funded)return` in `operations.test.ts`.
- [x] Execution core (offline half): loader + scenario planner (`e2e/core/
{loader,plan,interpolate}.ts`) — fixture/param expansion, capability→deferred
      gating, phase numbering, redacted labels — and the CLI `e2e/cli.ts`
      (`list` / `validate` / `dry-run` with `--scenario`/`--tag`/`--lane`/
      `--shuffle`/`--caps`). `dry-run` prints the fully expanded, redacted plan +
      capability decision + end state (`e2e:list`/`e2e:dry-run` scripts).
- [x] Execution orchestrator + driver seam: `e2e/drivers/driver.ts` (Driver /
      CommandRunner / ArtifactSink interfaces + FakeDriver/FakeCommandRunner/
      MemoryArtifactSink) and `e2e/core/run.ts` — dispatches every step, emits the
      event stream, captures a **screenshot + AX snapshot after every step**
      (AX/text redacted; bitmaps owner-private and unmodified by default),
      runs cleanup in a `finally` on all paths (visible after
      failure; failed cleanup fails the run), short-circuits capability-deferred,
      and asserts visible/ax/balanceDelta/tx. `launch` step added to the schema.
      `bun e2e/cli.ts run --driver fake` exercises orchestration offline and is
      never product or device evidence.
- [x] Enable simulator-only execution behind destructive-reset approval. Each
      explicit ordinary-simulator instance group gets a unique compatible iOS
      simulator, random loopback Metro, foreground serve-sim, secret-free
      environment, bound install operation, exact-UUID cleanup, and signal
      handling. Suite refs declare `newInstance`; a reused selection retains its
      prerequisite prefix, and group members execute in correctness order.
      `onboarding.fresh` passed alone as a real product run with per-step
      screenshots, AX, and final wallet proof. Funded execution remains one
      fresh simulator per scenario behind its additional authorization/recovery
      boundary; generic live and physical work remains separate.
- [x] Add independent funded authorization. Simulator deletion requires
      `--i-approve-destructive-reset`; selecting any funded scenario additionally
      requires `--i-accept-test-fund-loss`, before artifacts, Metro, cocod, or
      simulator side effects.
- [x] Extend the strict scenario schema with exact
      `{mintUrl,unit,accountIndex,maxPrincipal}` assets (200-sat aggregate cap) and
      closed semantic operations for Cashu, BOLT11, Lightning addresses, and
      `recovery.sweep`. Authored JSON cannot spell raw cocod commands.
- [x] Implement owner-private recovery custody for the generated app mnemonic,
      optional controlled P2PK key, NUT-13 counters, resumable bearer tokens, and
      asset reconciliation. Directories/files are `0700`/`0600`, and secrets are
      deleted only after every asset is reconciled.
- [x] Implement host NUT-13 recovery and exact cocod accounting: restore all
      declared account-0 mint/unit keysets, reject `PENDING`/incomplete proof
      states, persist tokens before redemption, account for fees, re-probe zero
      residual, and prove final balance = baseline + ordered operation deltas.
- [x] Implement the mode-`0600` global funded-run lock primitive and resumable
      prepared/received recovery phases. A dead lock cannot be cleared until
      liabilities are clean; active or corrupt ownership fails closed.
- [x] Make prepared app Cashu outflows restart-safe. Startup verifies the full
      token SHA-256, retries an entirely `UNSPENT` token once, repairs already
      credited `SPENT` evidence idempotently, and retains custody for `PENDING`,
      mixed, or partial/excess/negative cocod-drift states. Only an exact full
      credit is attributable. A `SPENT` token with no cocod credit becomes
      `spent-uncredited` only under explicit test-fund-loss acceptance; its lost
      principal is recorded before the remainder is swept.
- [x] Wire automatic stale-run discovery/recovery and the global lock into CLI
      startup before any new funded value effect. Recovery resumes stale custody,
      reconciles/re-probes it, re-audits clean, then clears only a dead lock;
      unreachable, `PENDING`, residual, or ambiguous state blocks. The first
      funded product run started recovery-clean and released its lock only after
      exact reconciliation.
- [x] Run the first real funded scenario through the complete boundary and record
      pre/post `cocod balance` evidence. On 2026-07-12, `send.cashu.sat` funded
      100 sats, asserted the 40-sat transaction as pending, observed its pending
      status toast, redeemed the token into cocod, observed automatic transaction
      finalization and token-data removal, swept the remaining 60 sats by NUT-13
      recovery, verified the app at zero, restored cocod's Sovran-mint balance
      `2882 → 2782 → 2822 → 2882` with zero fee, and deleted the owned ephemeral
      simulator.
- [x] Fixture library (`e2e/fixtures/`): fresh-install, onboard, funded setup,
      return-to-wallet, and `flow.sweep-mint` — reusable flows composed via `use`
      (params interpolated, runtime `${capture}` left for the orchestrator). The
      cleanup fixture now delegates to semantic host `recovery.sweep`; it has no
      amount and never guesses an app UI send. Added bounded `tapUntil` and
      clipboard capture primitives.
- [x] Authored four compact JSON payment definitions informed by the old `.sov`
      corpus (`e2e/scenarios/`):
      receive.lightning.sat, receive.cashu.paste, send.cashu.sat, send.lightning.sat
      — each defines independent setup, a wallet end state, balance/visibility
      assertions, and cleanup. All four are promoted with funded product evidence.
      On 2026-07-13,
      `receive.lightning.sat` created and settled a real 100-sat quote, asserted
      the wallet delta, swept the exact asset back to cocod, restored the app to
      zero and cocod to 2882 sats, and deleted its owned ephemeral simulator. Later
      that day, `receive.cashu.paste` run
      `2026-07-13T03-53-19-696Z-9c6fc229` created a controlled 50-sat bearer
      token, pasted and redeemed it, proved finalized Paste-source transaction
      truth and a +50 app delta, swept the exact asset, restored the app to zero
      and cocod `2882 → 2832 → 2882`, reconciled funds, and deleted the owned
      simulator.
- [x] Promote `send.lightning.sat` after repairing its bounded 100-sat funding
      handoff and native-visible Paste selector. Run
      `2026-07-13T06-07-18-450Z-fa39bfff` previewed and paid a controlled 40-sat
      invoice, proved the product `PAID` state before cocod settlement, and
      observed an exact -40 app delta with no fee. Recovery swept the remaining
      60 sats, reconciled the final wallet to zero, restored cocod exactly
      `2882 → 2782 → 2822 → 2882` with Minibits unchanged at 1331 sats,
      and deleted the owned ephemeral simulator.
- [x] Promote `send.lightning.dismiss` after exposing Cancel for synthetic unpaid
      previews while retaining rollback-before-exit for real quotes. Run
      `2026-07-13T06-42-23-795Z-ae2d2f7a` funded 100 sats, opened a controlled
      unpaid 40-sat synthetic preview, cancelled without exposing Pay or settling
      the invoice, and proved a zero app delta with no melt history row. Raw QA
      screenshots captured the preview and unchanged wallet; recovery swept the
      exact untouched 100 sats, reconciled cocod `2882 → 2782 → 2882`, and
      deleted the owned ephemeral simulator.
- [x] Promote `payment.request.delivery-rollback` after adding a bounded NUT-18
      clipboard fixture, funded-only deterministic delivery-failure control,
      structured preview/persisted transaction probes, and exact recovery sweep.
      Artifact `run-2026-07-13T07-24-44-653Z-3cf0239f` passed in 329.8 seconds:
      100 sats were funded, the 30-sat preview moved `prepared`→`rolledBack`, the
      live screen showed `Delivery failed — funds returned to your balance`.
      The reopened detail remained `rolledBack` and showed
      `Funds returned to your balance`. Raw unmasked screenshots captured every
      step. The app reconciled
      `0 → 100 → 100 → 0`; exact sweep restored cocod
      `2882 → 2782 → 2882` with zero fees and zero residual, cleanup and final
      wallet verification passed, and the owned ephemeral simulator was deleted.
- [x] Promote `tx.source.cashu-paste` after replacing its stale structured-probe
      blocker with strict preview/final transaction identity and source checks.
      Artifact `run-2026-07-13T07-31-13-536Z-a311d9b7` passed in 256.8 seconds:
      cocod created an exact 50-sat Sovran-mint token; its source-less incoming
      preview was `prepared`, and redemption produced a distinct finalized
      transaction id with source `paste`. `Source` / `Clipboard` rendered both
      immediately and after reopening the wallet row. Raw unmasked screenshots
      captured every step. The app moved `0 → 50 → 0`; exact cleanup recovered
      50 sats with zero residual and zero fees, reconciled cocod
      `2882 → 2832 → 2882`, passed the final wallet check, and deleted the fresh
      ephemeral simulator.
- [x] Promote `receive.cashu.dismiss` after adding stable Cancel and prepared
      transaction probes plus host custody for the unspent counterparty token. Run
      `2026-07-13T03-59-32-846Z-dcba992f` previewed a controlled 50-sat token,
      proved its prepared structured transaction, cancelled without redeeming,
      observed zero app balance or history mutation, recovered the unspent token
      on the host, reconciled funds, verified the final wallet at zero, and deleted
      the owned ephemeral simulator.
- [x] Promote `toast.receive-lightning` after adding render-bound payment-status
      lifecycle probes and an exact retained View callback. Run
      `2026-07-13T04-42-27-892Z-ec3f33af` captured raw screenshots of the real
      processing and confirmed stages, opened the matching incoming terminal
      `ISSUED` transaction through View, proved a +33 wallet delta and no replay
      after relaunch, swept the 33 sats, reconciled cocod exactly
      `2882 → 2849 → 2882`, and deleted the owned ephemeral simulator.
- [x] Promote `send.cashu.pending-reclaim` after adding strict transaction and
      token-data probes, exact host custody/sweep, and action-menu readiness tied
      to both the current popup `openSeq` and the native open snap point. Run
      `2026-07-13T05-14-34-351Z-a74ca7c0` funded 100 sats, created a 40-sat
      pending token, proved 60 sats / -40 delta, exercised Check Status, reopened
      the menu without reusing its stale exit marker, cancelled and removed the
      token data, proved `rolledBack`, restored 100 sats / zero net delta, and
      reopened persistent `Cancelled` / `Funds returned to your balance` detail.
      Raw QA screenshots captured pending and reclaimed states; exact sweep
      restored the app to zero and cocod `2882 → 2782 → 2882` with zero
      fees, reconciled funds, and deleted the owned ephemeral simulator.
- [x] Promote `send.token.actions` after proving its copy, native share, QR,
      rendered-status, transaction, and exact custody seams. Run
      `2026-07-13T05-48-53-705Z-9486e246` funded 128 sats, created a pending
      63-sat token, verified exact text copy and emoji round-trip, detected and
      dismissed the current-iOS native share sheet, and changed QR speed
      Medium→Slow plus density Heavy→Light. Check Status produced the pending
      toast; Cancel removed token data, proved `rolledBack`, restored 128 sats /
      zero net delta, and persisted `Cancelled` / `Funds returned to your
balance`. It ended on the wallet, swept the app to zero, reconciled cocod
      `2882 → 2754 → 2882` with Minibits unchanged at 1331 sats, and deleted the
      owned ephemeral simulator.
- [x] Replace sentinel-only priority inventory with complete compact-JSON plans
      for recovery, mint-change, reclaim/rollback, NPC receive, toast replay,
      transaction source, and dismiss/actions, plus an explicit draft for
      payment-root isolation. Each deferred plan names its missing selector,
      fixture, driver, custody, product seam, or redesign requirement.
      Legacy-derived cases remain coverage research, not a commitment to full
      `.sov` parity or an acceptance criterion for this slice; individually
      promoted scenarios stand only on their own product evidence.
- [ ] Promote future money scenarios by current product risk and state-machine
      coverage, not blanket legacy parity. A promoted case needs transaction and
      toast assertions where relevant plus declared assets and a typed
      `recovery.sweep` cleanup path through the approved funded runtime.
- [x] Per-step AND per-sub-step evidence: `run.ts` captures owner-private
      screenshot + redacted AX evidence after every step and after each
      `tapUntil` sub-action, so nested actions have distinct artifact names.
      Screenshots are unmodified QA evidence by default, including payment and
      native share-sheet content. Each raw bitmap exists only as `0600` inside a
      randomized `0700` temporary directory and is bracketed by one-shot AX
      snapshots; artifact directories must not be shared. Explicit JSON `mask`
      ids remain supported and activate the existing authored plus
      sensitive-region masking path, but no checked-in scenario enables it.
      Seed export uses authenticated random-token loopback IPC and bypasses both
      console output and the evidence stream. Static-toast checks mount a DEV-only
      key/sequence accessibility marker beside the rendered HeroUI component; it
      contains neither toast text nor value. Payment-status checks use a
      render-bound lifecycle marker and retained exact View callback. Fake smoke
      still does not prove screenshot or product behavior on a device.
- [x] Verify screenshot settling and native `DevLoadingView` clearance through
      the passing onboarding product run; extend stable-frame coverage when each
      additional simulator scenario is promoted.
- [x] Encode bounded `tapUntil …until:<dest>` plans for method chooser and overlay
      interactions. Validation/fake-driver coverage proves bounded orchestration,
      not that those coordinates or delays work on a simulator.
- [ ] Add the remaining stable test/driver seams. Core send/receive, amount/mint,
      Next, pay/redeem, token-action, quote-id, toast, dismiss, P2PK, transaction-row,
      exact mint-row, native-share dismissal, and strict structured transaction
      probes now expose useful IDs/contracts. **Remaining priority gaps:**
      dynamic `flow-header-back` / `flow-header-close`,
      `payment-context-probe`, deterministic `e2e-open-*`
      entry adapters, and scenario-specific native/lifecycle controls. No payment
      leg is called reliable without its own device proof.
- [x] Onboarding scenario + named `Welcome to Sovran` checkpoint passed on an
      owned ephemeral simulator and reached a proven final wallet state.
- [ ] Traverse and assert every onboarding carousel slide.
- [x] Implement the explicit ordinary-simulator instance-group contract. The
      `full` suite places `recovery.reinstall` after `onboarding.fresh` with
      `newInstance: false`; focused recovery selection retains that onboarding
      prerequisite, both scenarios share one owned simulator, dependent execution
      stops on prerequisite failure, and the group still has exact-UUID cleanup.
      Funded scenarios remain fresh and cannot join a reuse group.
- [x] Author `recovery.reinstall` with explicit profile-continuity checks and
      `finally` cleanup. It consumes the wallet created by its declared onboarding
      prerequisite instead of onboarding again internally.
- [x] Run the named onboarding-to-`recovery.reinstall` group on a fresh ephemeral
      simulator. On 2026-07-13 both scenarios passed in one owned session: the app
      was reinstalled without replacing the simulator, RestoreGate completed,
      the recovered drawer profile name exactly matched the captured onboarded
      profile name, the wallet final state and cleanup passed, and the simulator
      was deleted. The unexecutable deferred destructive-funded recovery scenario
      was removed; that lifecycle remains an explicit coverage gap rather than a
      scenario that can never produce product evidence.
- [x] Author complete mint-change and rollback/reclaim plans:
      `receive.lightning.change-mint.amount`, `send.cashu.change-mint.amount`,
      `send.lightning.change-mint.preview`, `send.cashu.pending-reclaim`, and
      `payment.request.delivery-rollback`.
- [x] Promote `receive.lightning.change-mint.amount` after replacing its stale
      selector/driver blockers with the shipped amount/mint probes, strict
      transaction probe, and iOS action-menu-open coordinate seam. Its first
      product run on 2026-07-13 proved onboarding, 125-sat entry, and selector
      entry, then stopped because the exact Minibits `/v1/info` endpoint closed
      the TLS connection; host curl and `cocod mints info` reproduced the same
      external failure. Keep it runnable and rerun unchanged when Minibits is
      reachable rather than converting endpoint availability into a deferral.
- [ ] Promote the remaining plans only after their fixture/native/product blockers
      are resolved. Preserve section 11 product gaps as gaps, never
      expected-success assertions.
- [x] Author complete plans for `receive.npc.sat`,
      `toast.receive-lightning`, and `tx.source.cashu-paste`, with checkpoints and
      explicit blockers for each case while it remains unpromoted.
- [ ] Redesign `isolation.payment-roots` before promotion. The current draft
      depends unnecessarily on remote Minibits, lacks immediate per-root probes
      and deterministic entry adapters, and can false-pass by opening a second
      wallet root that clears context before the assertion. Split out the
      independently driveable Send↔Receive amount-reset case, then add one
      dirty-context → actual-root → immediate-clean-probe case per remaining root.
- [ ] Promote the remaining plans only after controlled fixtures, stable selectors,
      structured transaction fields, approved cleanup, and any named product gap
      are resolved. Isolation covers app context only, never NFC radio transport.
- [ ] Diagnose MintAddScreen p50/p95; capability-gated multi-unit/split;
      offline/proximity; deterministic Nostr/NIP-46/media/poll; DS + a11y expansion.
- [x] Retire `.sov` as a human-authored test format and remove the old screenshot
      harness. The JSON definitions preserve useful research, but this slice does
      not claim or require full behavioral parity. The historical fund record is
      retained at `e2e/artifacts/legacy-SEEDS.json`; it is not current-run evidence.
- [ ] Retire the `.sov` **runtime** (`log-doctor/test-dsl/`) — deferred: log-doctor
      imports it and hosts `log-doctor phone test`, so this is a log-doctor refactor
      slice (decouple the importers), not a delete. Not a compatibility shim.
- [ ] Add an aggregate verification/report command that runs wallet Vitest, app
      Jest, JSON validation, and each authorized JSON lane as separate jobs, then
      reports their coverage statuses without pretending one runner covered the
      others.

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
- [x] Wallet Send/Receive/QR, wallet mint selector, Send QR/NFC/Nut Drop,
      ambient NFC, profile/chat sends, feed invoices, and deep-link scan clear
      stale app routing context at their audited roots; amount draft clearing is
      pinned.
- [ ] Fix both Routstr top-up entries to clear incompatible prior app context and
      reset Colada before setting the new Routstr route. The order-190 audit found
      direct navigation in `AiHeaderTitle` and `useAiSend`, so broad root-isolation
      product evidence must remain blocked.
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
