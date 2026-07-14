# ADR: JSON-native functional-test definitions and fail-closed harness

Status: **Accepted (funded baseline proven; expansion in progress)** · Supersedes the "keep the `.sov`
DSL as the human-authored regression suite" stance in `testing-strategy.md`.

This ADR records the architecture. The durable worklist is in
`testing-roadmap.md`; the source-backed layer decisions are in
`testing-coverage-ledger.md`.

## Context (verified from the live tree, not assumed)

- **Existing automated estate is large and cheap — keep it authoritative.** App
  Jest, wallet Vitest, structural snapshots, and the Design System inventory own
  deterministic contracts. Their registries and tests, not a copied count in
  this ADR, are the current source of truth.
- **Payment engine is `sovran-app/wallet`** (coco-v2). Routing is centralized in
  pure functions (`resolveNext`, `resolveFromContext`, `transition`) and a pure
  `getAvailableActions` availability table. Most transition behavior is
  model-provable in Vitest.
- **Selector work is now part of the harness contract.** The original audit found
  major gaps; stable amount, mint, quote, toast, token-action, P2PK, transaction,
  and dismiss probes have since been added. Remaining scenario-specific gaps stay
  explicit in `testing-coverage-ledger.md`; required controls still fail closed.
- **cocod is the approved SAT counterparty for the funded lane.** The decision is
  deliberately to use the operator's current low-value `~/.cocod` wallet, not to
  claim process or wallet isolation that cocod does not provide. Preflight pins
  one absolute binary (`COCOD_BIN`, otherwise `${HOME}/.bun/bin/cocod`), accepts
  only version `0.0.16`, requires `UNLOCKED`, records the selected metadata, and
  never exposes or invokes `cocod history` because it prints proof secrets.
- **Legacy `.sov`** was inspected as migration research; its runtime remains at
  `app/codereview/log-doctor/test-dsl/` because log-doctor imports it. Its
  `events.ts` `RunnerEvent` union and `tty-reporter.ts` are the concepts worth
  reimplementing. The historical corpus had known-bad assumptions: `launch-fresh`
  doesn't reset; send tests assume prior funds; pending/unpaid tests contaminate
  history; happy paths end on tx-detail not wallet; required controls hide inside
  `if visible` (false passes); QR/emoji/check-status assert nothing; no
  balance/mint/unit/source/toast/cleanup assertions; `verification.ts` rewrites
  `# verified:` stamps **into source files**.
- **The separate wallet-integration hazard remains closed in the default gate:** the three
  live-mint files are excluded unless the explicit live script is selected;
  `requireLiveMint` has no public-mint default; and funded setup now throws
  instead of returning a silent green. The JSON funded lane has its own explicit
  authorization, custody, counterparty, and recovery boundary.

## Firm decisions

1. **JSON is the only human-authored functional/device test format.** No `.sov`
   compiler, translator, adapter, alias, fallback, or dual-runner. `.sov` is read
   **once** as migration research and then retired (see Retirement).
2. **Reuse low-level implementation only where it yields a clean JSON-owned
   design.** Schema, planning, selection, events, reporting, and fake-driver
   orchestration are JSON-owned and do not depend on the `.sov` runtime. The
   owned ephemeral-simulator driver is active and has separately named product
   evidence; fake-driver results remain non-product orchestration evidence.
3. **Do not duplicate the Jest/Vitest matrices on device.** Device/JSON owns only
   what pure layers cannot prove (real nav, native surfaces, async finalization,
   rendered toasts, cross-root isolation, real cocod round-trips, tx-truth).
4. **No Maestro expansion.**
5. **Never stamp verification dates into source.** Run metadata lives in an
   immutable run manifest, not in test files (rejects the `verification.ts`
   pattern).

## Architecture

Current tree under `app/e2e/`:

```
e2e/
  schema/         versioned JSON Schema + validator + compact-format check
  core/           loader, selection, planning, event bus, redaction, orchestration
  reporting/      TTY + plain + JSONL consumers
  counterparties/ cocod binary/version/help preflight and closed capabilities
  funded/         NUT-13 recovery, exact-asset custody, typed cocod adapter
  funded-runtime/ semantic effects, cocod accounting, global funded-run lock
  ledger/         durable liabilities, effect leases, custody and reconciliation
  drivers/        strict fakes plus owned ephemeral-simulator execution
  fixtures/       parameterized reusable definitions
  suites/         ordered manifests (lanes: simulator | funded | live | physical)
  scenarios/      one scenario per file, compact JSON
  artifacts/      ignored output/historical records; no current device evidence
```

- **Suite manifest** owns version, name, ordered scenario references, and the
  default end state. Each reference repeats
  only id, file, order, lane, effective requirements, end state, and an explicit
  `newInstance` decision so cross-file validation can catch drift. For ordinary
  simulator refs, `true` opens a newly owned ephemeral-simulator group and each
  immediately following `false` ref reuses that group. Order is correctness
  state only inside a declared reuse group; outside those groups it remains
  editorial/cost-aware. Selecting a reused member includes the prerequisite
  prefix back to the group's `true` boundary, while shuffle moves whole groups
  without reordering their members. Funded refs must start fresh and cannot join
  a reuse group. Unsupported resource-lock, fee-budget, retry, and cleanup-policy
  controls remain strict-schema errors rather than decorative promises.
  `full.json` references every authored scenario exactly once; `default.json` is
  simulator-only and rejects unsafe counterparty effects.
- **Scenario** = `{version,id,name,description,lane,tags,requires,funds?,setup,steps,
verify,finally,endState,deferredReason?}`; every funded scenario declares exact
  `{mintUrl,unit,accountIndex,maxPrincipal}` assets (aggregate principal capped at
  200 sats); exactly one
  action per step; required controls fail-hard when absent; optional controls
  must be explicitly `optional` **with a reason** (no `if visible` around required
  behavior); bounded matrices over loops; no arbitrary shell — every external
  command is typed, allowlisted, timed out, redacted.
- **Compact-JSON rule:** valid JSON (not JSONC), one record per line where
  practical, strict versioned schema; only the exact test-JSON globs go in
  `.prettierignore` + a dedicated compact-format check (TS/MD/other JSON not
  exempted).
- **Capability-aware:** scenarios declare `requires` (e.g.
  `["cocod.send.cashu","unit.sat"]`); unmet → `◌ deferred <reason>` (not a silent
  skip). An explicit `deferredReason` also short-circuits before prerequisites;
  it keeps blocked coverage visible without fabricating an expected-success
  flow. Funded capabilities come from the pinned cocod preflight; generic live
  and physical execution remain outside this boundary.
- **Counterparty operations are semantic, not shell.** JSON may request only the
  closed operations `cashu.create`, `cashu.redeem`, `bolt11.create`,
  `bolt11.pay`, `bolt11.settled`, `lightning-address.resolve`,
  `lightning-address.pay`, and `recovery.sweep`. The runtime owns argv, timeouts,
  typed secret delivery, exact asset selection, and balance observation. Raw
  `cocod` commands are rejected from authored plans.
- **Phase naming is part of the contract:** prerequisite fixture steps are `Pxx`,
  authored tested behavior is `Txx`, the explicit verification section is `Vxx`,
  and cleanup is `Cxx`. A mid-flow assertion stays `Txx` when more product
  behavior follows; phases are never inferred from action type. Fixture
  provenance remains attached after expansion. The reporter prints an explicit
  test-start boundary between `P` and `T`, so funding/onboarding setup cannot be
  mistaken for the behavior being tested.
- **Reporter = event stream is the truth.** The `RunnerEvent` union covers
  (run/suite/scenario/fixture/phase/step/assertion/retry/skip/deferred/artifact/
  funding/cleanup/sweep-leg/reconciliation/quarantine/final-state). TTY renderer
  is append-only scrollback + one live area (braille spinner, unicode state
  glyphs `▶▸▣✓✗⚠↺⏭◌♻→╰⏱`, nested indentation, per-step timing, progress and
  elapsed time); plain and JSONL consume the same stream. Event emission and
  artifact text/AX paths apply redaction; tests cover representative secret
  forms. JUnit remains future work.
- **Execution boundary:** simulator execution requires
  `--i-approve-destructive-reset`; selecting a funded scenario independently
  requires `--i-accept-test-fund-loss`. Both fail before artifacts, Metro, cocod
  effects, or device creation. Every ordinary-simulator group gets a newly
  created ephemeral simulator owned by that session and never erases or reuses
  an existing device. Declared `newInstance: false` scenarios may reuse only the
  immediately preceding ordinary-simulator group and share its cleanup boundary;
  a failed prerequisite prevents dependent scenarios from running. Every funded
  scenario starts a separate fresh session. A funded session additionally
  preflights the pinned current cocod wallet, exports its freshly generated app
  mnemonic through an
  authenticated random-token HTTP endpoint bound to `127.0.0.1` directly into a
  private callback, and establishes recovery custody before value moves. The
  mnemonic never crosses console/Metro output or the evidence stream. Live and
  physical lanes remain disabled. `send.cashu.sat` recorded funded simulator
  product evidence on 2026-07-12; `receive.lightning.sat`,
  `receive.cashu.paste` run `2026-07-13T03-53-19-696Z-9c6fc229`,
  `receive.cashu.dismiss` run `2026-07-13T03-59-32-846Z-dcba992f`,
  `toast.receive-lightning` run `2026-07-13T04-42-27-892Z-ec3f33af`,
  `send.cashu.pending-reclaim` run `2026-07-13T05-14-34-351Z-a74ca7c0`,
  `send.token.actions` run `2026-07-13T05-48-53-705Z-9486e246`,
  `send.lightning.sat` run `2026-07-13T06-07-18-450Z-fa39bfff`,
  `send.lightning.dismiss` run
  `2026-07-13T06-42-23-795Z-ae2d2f7a`, and
  `payment.request.delivery-rollback` artifact
  `run-2026-07-13T07-24-44-653Z-3cf0239f`, and `tx.source.cashu-paste`
  artifact `run-2026-07-13T07-31-13-536Z-a311d9b7` recorded their own funded
  product evidence on 2026-07-13.
- **Custody and recovery boundary:** the app mnemonic, exact asset declarations,
  monotonic NUT-13 counters, resumable Cashu redemption records, counterparty
  bearer tokens, and optional controlled P2PK private key live only in owner-only
  directories/files (`0700`/`0600`). `recovery.sweep` is a host operation with no
  guessed UI amount: it restores account-0 proofs for every declared mint/unit,
  rejects `PENDING` or incomplete states, prepares the maximum spendable token
  after fees, persists it before cocod redemption, and re-probes exact balances.
- **Crash and accounting boundary:** one global mode-`0600` funded-run lock
  serializes value-moving runs. A dead lock may be cleared only after automatic
  stale-custody resume has reconciled every liability and a clean re-audit has
  passed; active, corrupt, unreachable, `PENDING`, or residual states block new
  value effects. Prepared app Cashu outflows are full-fingerprint checked:
  `UNSPENT` retries once, credited `SPENT` repairs evidence idempotently, and
  `PENDING`, mixed, or partial/excess/negative balance drift retains custody;
  only an exact full credit is attributable. Zero-credit `SPENT` is recorded as
  `spent-uncredited` only under explicit loss acceptance. Every cocod effect
  records before/after balances and the run finalizes only when
  baseline plus the ordered exact deltas equals the final balance for every
  declared asset. Private recovery material is deleted only after reconciliation.
  The `send.cashu.sat` product run proved pending-toast and
  pending-to-finalized transaction behavior plus
  `2882 → 2782 → 2822 → 2882`: 100 sats funded, 40 redeemed, 60 swept, zero fee.
  `receive.cashu.paste` additionally proved controlled bearer-token custody into
  the app, finalized Paste-source transaction truth, and exact
  `2882 → 2832 → 2882` create/sweep reconciliation. `receive.cashu.dismiss`
  proved prepared structured preview truth, Cancel with zero app balance/history
  mutation, and host recovery of the still-unspent token with the same exact
  reconciliation. `toast.receive-lightning` proved the rendered receive toast's
  processing→confirmed lifecycle, exact View callback into its incoming terminal
  `ISSUED` transaction, +33 wallet delta, no terminal replay after relaunch, and
  exact `2882 → 2849 → 2882` pay/sweep reconciliation.
  `send.cashu.pending-reclaim` proved a 40-sat pending token from a 100-sat
  wallet, the intermediate 60-sat / -40 delta, rendered pending-status feedback,
  cancel/reclaim with token-data removal, `rolledBack` transaction truth, and a
  restored 100-sat / zero net delta. Reopening the detail preserved `Cancelled`
  and `Funds returned to your balance`; host sweep then reconciled the app to
  zero and cocod exactly `2882 → 2782 → 2882` with zero fees.
  `send.token.actions` proved exact raw-text copy and emoji round-trip of one
  pending 63-sat token, current-iOS native share-sheet detection and dismissal,
  and QR speed Medium→Slow plus density Heavy→Light controls. Its rendered
  pending toast, Cancel, token-data removal, `rolledBack` transaction, restored
  128-sat / zero-delta wallet, and reopened persistent returned-funds detail all
  passed. The final wallet and exact host sweep reconciled the app to zero and
  cocod `2882 → 2754 → 2882`; Minibits remained at 1331 sats, and the owned
  ephemeral simulator was deleted.
  `send.lightning.sat` proved the repaired bounded 100-sat funding handoff and
  native-visible Paste selector, a controlled 40-sat invoice preview/payment,
  and the product `PAID` state before cocod settlement. The app delta was exactly
  -40 with no fee; recovery swept the remaining 60 sats, reconciled the final
  wallet to zero, and restored cocod exactly
  `2882 → 2782 → 2822 → 2882` while Minibits remained at 1331 sats. The
  owned ephemeral simulator was deleted.
  `send.lightning.dismiss` proved Cancel on a controlled synthetic unpaid 40-sat
  preview without exposing Pay or settling the invoice. The wallet retained its
  funded 100 sats with a zero net delta and no melt history row; raw screenshots
  captured the preview and unchanged wallet. Recovery swept the exact untouched
  100 sats, reconciled cocod `2882 → 2782 → 2882`, and deleted the owned
  ephemeral simulator.
  `payment.request.delivery-rollback` funded 100 sats and induced a deterministic
  30-sat NUT-18 delivery failure. Its structured preview moved
  `prepared`→`rolledBack`, the live screen rendered
  `Delivery failed — funds returned to your balance`, and the reopened persisted
  detail remained `rolledBack` with `Funds returned to your balance`. The app
  conserved value through `0 → 100 → 100 → 0`; exact host sweep restored cocod
  `2882 → 2782 → 2882` with zero fees and zero residual. Artifact
  `run-2026-07-13T07-24-44-653Z-3cf0239f` passed in 329.8 seconds with raw
  unmasked screenshots, successful cleanup/reconciliation/final-wallet proof,
  and owned-simulator deletion.
  `tx.source.cashu-paste` proved that a controlled 50-sat Sovran-mint token first
  appeared as a source-less `prepared` incoming preview, then redemption created
  a distinct finalized transaction id annotated with source `paste`. The live
  detail rendered `Source` / `Clipboard` both immediately and after reopening
  the matching wallet row. The app moved `0 → 50 → 0`; host recovery recorded
  50 sats recovered with zero residual and zero fees, while cocod reconciled
  exactly `2882 → 2832 → 2882`. Artifact
  `run-2026-07-13T07-31-13-536Z-a311d9b7` passed in 256.8 seconds with raw
  unmasked screenshots, successful cleanup/reconciliation/final-wallet proof,
  and fresh owned-simulator deletion.
- **Evidence boundary:** event and AX text is redacted; artifact directories and
  files are owner-only (`0700`/`0600`). Screenshots are unmodified QA evidence by
  default, so bearer tokens, invoices, addresses, profile data, and native share
  sheets may be visible; artifact directories must not be shared. Raw frames are
  pre-created `0600` inside randomized `0700` temporary directories, removed in
  `finally`, and bracketed by direct one-shot AX snapshots. The optional JSON
  `mask` field remains supported: once a checkpoint supplies a mask id, its named
  regions and the existing sensitive-region detections are blackened. No
  checked-in scenario currently opts in. DEV-only render-bound toast probes mount
  with the real HeroUI components and expose only closed static or lifecycle
  markers; the successful payment-status run retains raw screenshots as the
  visual evidence. The action-menu probe binds its render marker to the current
  popup `openSeq` and waits for the native sheet's open snap point, preventing a
  reopened menu from reusing a stale marker while the previous sheet exits. A
  token-bearing scenario may be promoted only when its token is consumed or
  reconciled in the same run; the screenshot is QA evidence, not custody.
- **Current cocod wallet is an explicit choice:** the approved boundary
  acknowledges `~/.cocod` as the current low-value test counterparty, pins the
  process and version for the run, and requires it unlocked. It does not relabel
  that wallet as isolated, and acceptance of possible test-fund loss remains a
  separate user-facing gate.

## Layer ownership (grounded in the wallet map)

- **Wallet Vitest** — routing/availability/effect/generation/lock matrices,
  parser/codec, amount/fee/unit/mint/proof math, P2PK/HTLC, offline composition,
  timeline derivation, property tests.
- **App Jest** — stores/persisted schema, component contracts, route selection,
  toast reducers/gating, formatting, feed/thread/notification mapping, NIP-46
  policy, DLEQ/NFC/BLE parsing, Design System structural + structural a11y.
- **JSON/device** — onboarding/recovery UI, real nav + sheets, OS keyboard/
  clipboard/QR/gallery/deep-link/permission boundaries, rendered toasts, native
  screenshot+AX evidence, profile-switch/restart, real cocod SAT round-trips,
  final tx row/detail/source, cross-root isolation, background/kill/reinstall,
  one canonical funded path per high-risk rail. Ownership is not evidence: each
  scenario remains deferred until its own blockers are removed and it passes.
- **Physical lane** — real NFC/BLE/NutDrop transport, two-device discovery, radio
  loss/writeback timing. Simulator coverage never claims physical transport.

## Prerequisites the audit surfaced

- **Finish remaining stable driver seams.** The shared payment controls and
  structured transaction probes now cover the core funded plans; any remaining
  scenario-specific selector or native contract stays a named promotion blocker.
- **Keep the funded-integration hazard closed**: the default wallet gate excludes
  the three live-mint files; their helper has no public-mint default; and live
  setup fails loudly. This remains separate from JSON device execution.

## Retirement of `.sov` (no compatibility layer)

**Source-format retirement done (2026-07):** JSON is now the only human-authored
format. The decision does not depend on a claimed device run or full behavioral
parity. The following were retired with no adapter and no dual-run:

- `app/tests/*.sov` + `app/tests/_shared/*.sov` — the human-authored corpus.
- `app/e2e-screenshots/` — the prior screenshot harness. Useful implementation
  ideas informed the JSON-owned prototypes; the historical `SEEDS.json` record
  was preserved as `e2e/artifacts/legacy-SEEDS.json` and is not current-run proof.

`receive.cashu.dismiss` graduated from that research list through product run
`2026-07-13T03-59-32-846Z-dcba992f`, `send.cashu.pending-reclaim` through run
`2026-07-13T05-14-34-351Z-a74ca7c0`, `send.token.actions` through run
`2026-07-13T05-48-53-705Z-9486e246`, and `send.lightning.dismiss` through run
`2026-07-13T06-42-23-795Z-ae2d2f7a`; each proves only its named behavior, not
blanket `.sov` parity. Completing a parity program is not an acceptance criterion
for this slice.

**Deferred (documented, not a compatibility shim):** the `.sov` _runtime_ under
`app/codereview/log-doctor/test-dsl/` is **not** deleted — log-doctor imports it
(`parser`, `executor`, `discovery`, `verification`, `events`, `tty-reporter`,
`wallet`) and hosts `log-doctor phone test`, so it is a live dependency of a
production debugging tool, not dead code. Removing the `.sov`-execution role is a
separate log-doctor refactor slice (decouple those importers first), tracked in
the roadmap — deleting it now would break log-doctor.

## Consequences

- One JSON-owned authoring/planning system; the pure estate stays authoritative
  and cheap. Simulator execution and the explicit ordinary-simulator grouping
  contract are established in source. On 2026-07-13, the named
  onboarding-to-`recovery.reinstall` group passed on one fresh ephemeral
  simulator: onboarding, same-device app reinstall, RestoreGate recovery, exact
  drawer profile-name continuity, final wallet state, cleanup, and owned
  simulator deletion all passed. Funded execution has an approved fail-closed
  architecture, explicit gates, and eleven passing funded simulator scenarios
  (`send.cashu.sat`, `receive.lightning.sat`, `receive.cashu.paste`,
  `receive.cashu.dismiss`, `toast.receive-lightning`,
  `send.cashu.pending-reclaim`, `send.token.actions`, `send.lightning.sat`,
  `send.lightning.dismiss`, `payment.request.delivery-rollback`, and
  `tx.source.cashu-paste`); funded scenarios remain fresh, and live and physical
  execution remain disabled.
- The complete state-machine coverage contract lives in
  `testing-coverage-ledger.md`: every section 5 flow and section 11 shipped,
  partial, or gap item names its WV/AJ/JS/JF/JP owner. Deferred scenarios make
  omissions visible but are not evidence of product behavior.
- Scenario promotion still needs its stable selectors, controlled fixtures, and
  assertions. The funded recovery/counterparty/cleanup design and baseline
  runtime are proven; each additional scenario still needs independent product
  verification.
- The accepted foundation is schema → loader/planner/selection → event model →
  reporters → simulator orchestration → durable liabilities → mode-`0600`
  seed/P2PK custody → NUT-13 host recovery → typed cocod effects and exact
  accounting → scenario/coverage inventory. cocod isolation is explicitly not
  claimed, and live/physical lanes remain outside the accepted funded boundary.
