# Sovran testing strategy

Sovran has four different test jobs. They should share fixtures and scenario
names, but they should not be collapsed into one runner.

The implementation checklist and upstream gaps live in
[`testing-roadmap.md`](./testing-roadmap.md).

> **Functional/device lane direction (current):** the JSON-native harness under
> `app/e2e/` is the sole human-authored functional/device format. Its decisions
> live in [`testing-json-native-adr.md`](./testing-json-native-adr.md) and the
> layer-ownership map in [`testing-coverage-ledger.md`](./testing-coverage-ledger.md).
> The legacy `.sov` source corpus has been retired — no compiler, adapter, or
> dual-runner. The old runtime remains only as an internal log-doctor dependency
> until that tool is refactored; it is not an approved test-authoring surface.

| Lane                        | Owns                                                          | Current entry point                                                     |
| --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Pure and contract tests     | Funds math, codecs, persistence, state machines, hooks        | `bun run test`, `bun --cwd wallet run test` from the workspace          |
| Exact structural snapshots  | Stable rendered output for reusable components                | `bun run test:design-system`                                            |
| Deterministic visual checks | Native rendering of safe JSON scenarios on a simulator        | `bun run shots -- --suite default --i-approve-destructive-reset`        |
| Functional wallet flows     | Real navigation and value transfer with a counterparty wallet | Funded simulator lane behind both destructive-reset and fund-loss gates |

The first two lanes stay offline and deterministic. Simulator-lane scenarios
run only after explicit destructive-reset approval. Every ordinary-simulator
suite reference explicitly declares `newInstance`: `true` starts a newly owned
ephemeral simulator group, while subsequent `false` references reuse that
group's simulator, Metro, and serve-sim resources. Selecting a reused scenario
also selects the prerequisite prefix back to its group's `true` boundary, so a
focused recovery run cannot silently start without the account it must recover.
Success, failure, and handled signals clean the whole group without selecting,
booting, erasing, or reusing an existing device. Funded scenarios always retain
the fresh-device rule and additionally require explicit test-fund-loss
acceptance. Generic live and physical execution remains disabled.

## Exact component snapshots

`features/settings/design-system/catalog.ts` is the scenario source of truth.
Each scenario has:

- a stable id and title;
- the exact reusable component source files it covers;
- a deterministic render function used by both the in-app gallery and Jest.

`__tests__/designSystemScenarioSnapshots.test.tsx` renders those scenarios with
Testing Library. `canonicalizeReactTestTree` removes callbacks, refs, symbols,
and React bookkeeping while retaining component hierarchy, visible text,
accessibility output, test ids, class names, and resolved styles. A snapshot is
therefore an exact assertion over meaningful renderer output, not a dump of
unstable function identities.

Snapshot rules:

1. Freeze time, data, theme capabilities, and animation progress in a scenario.
2. Never read a network, persisted store, current balance, random id, or device
   clock from a snapshot scenario.
3. Cover states separately instead of cycling them during the snapshot.
4. Review snapshot changes as code. Updating snapshots is not a fix by itself.
5. Run `bun run test:design-system` twice; the second run must be unchanged.

`designSystemComponentInventory.test.ts` snapshots the complete reusable TSX
surface and divides it into `covered` and `pending`. Adding a component cannot
silently evade the Design System backlog.

## Where `serve-sim` belongs

`serve-sim` is a simulator sidecar, not a test runner and not a Metro wrapper.
It owns simulator preview, camera/QR injection, permissions, and low-level
simulator controls. The app exposes it through the `sim:*` package scripts.

Tracked camera fixtures must be deterministic and non-payable. Payable material
for an authorized funded run must be generated per run, cross the runner as a
typed secret, and remain ignored. The preview stays bound to `127.0.0.1` because
its control surface can execute simulator actions.

## Device and funded execution boundary

The simulator lane is enabled only for scenarios whose lane is exactly
`simulator`. The runner resolves a compatible installed iOS runtime, creates a
unique device from the returned `simctl create` UUID, starts secret-free Metro
and serve-sim sessions on random loopback ports, and deletes only that captured
UUID. `SIGINT`, `SIGTERM`, `SIGHUP`, setup failures, test failures, and success
share the same cleanup boundary. The existing `Sovran Screenshots` simulator and
unrelated Metro processes are never execution or cleanup targets.

That resource boundary is owned by an explicit ordinary-simulator group, not
implicitly by every scenario. A suite reference with `newInstance: true` opens
the group; immediately following `newInstance: false` references execute in
manifest order on the same owned device. Only order inside such a declared reuse
group is correctness state. Filters retain the prerequisite prefix when they
select a reused member, and shuffle moves complete groups without reordering
their members. A failure stops dependent members before the group is cleaned.
No group may cross into a funded, live, or physical scenario.

`onboarding.fresh` has executed as product evidence through this path, including
the named `Welcome to Sovran` screenshot and final wallet-state proof. Run it
with `bun run shots -- --suite default --scenario onboarding.fresh
--i-approve-destructive-reset`. Fake-driver success remains orchestration
evidence only.

`recovery.reinstall` has also executed as product evidence through the grouped
path. Selecting it retains `onboarding.fresh`, runs both on one newly owned
simulator, reinstalls only the app at the recovery boundary, completes the
RestoreGate scan, and proves the recovered drawer profile name exactly matches
the onboarded profile name. Run it with `bun run shots -- --suite full
--scenario recovery.reinstall --i-approve-destructive-reset`.

`send.cashu.sat` has also executed as funded product evidence. Run it with
`bun run shots -- --suite full --scenario send.cashu.sat
--i-approve-destructive-reset --i-accept-test-fund-loss`. The 2026-07-12 proof
funded 100 sats, proved the 40-sat transaction pending, exercised Check Status
and its pending toast, redeemed the token into cocod, observed automatic
finalization and removal of the token data, swept the app's remaining 60 sats
through NUT-13 recovery, verified the app at zero, restored cocod's Sovran-mint
balance exactly (`2882 → 2782 → 2822 → 2882`, zero fee), confirmed the named
token screenshot checkpoint, and deleted the owned ephemeral simulator.

`receive.cashu.paste` has also executed as funded product evidence. Run it with
`bun run shots -- --suite full --scenario receive.cashu.paste
--i-approve-destructive-reset --i-accept-test-fund-loss`. Run
`2026-07-13T03-53-19-696Z-9c6fc229` created a controlled 50-sat token, pasted
and redeemed it, asserted finalized Paste-source transaction truth and a +50
wallet delta, swept the exact asset, restored the app to zero and cocod exactly
`2882 → 2832 → 2882`, reconciled funds, and deleted the owned simulator.

`receive.cashu.dismiss` has likewise executed as funded product evidence. Run it
with `bun run shots -- --suite full --scenario receive.cashu.dismiss
--i-approve-destructive-reset --i-accept-test-fund-loss`. Run
`2026-07-13T03-59-32-846Z-dcba992f` previewed a controlled 50-sat token and its
prepared structured transaction, used Cancel without redeeming, proved zero
wallet balance or history mutation, recovered the unspent token through host
cleanup, reconciled funds, verified the final wallet at zero, and deleted the
owned simulator.

`toast.receive-lightning` has now executed as funded product evidence. Run it
with `bun run shots -- --suite full --scenario toast.receive-lightning
--i-approve-destructive-reset --i-accept-test-fund-loss`. Run
`2026-07-13T04-42-27-892Z-ec3f33af` paid a real 33-sat quote and captured raw QA
screenshots while the rendered payment toast advanced through processing and
confirmed. Its exact View callback opened the matching incoming terminal
`ISSUED` transaction, the wallet increased by 33 sats, relaunch did not replay
the terminal toast, and host sweep/reconciliation restored cocod exactly
`2882 → 2849 → 2882` before the owned simulator was deleted.

`send.cashu.pending-reclaim` has now executed as funded product evidence. Run it
with `bun run shots -- --suite full --scenario send.cashu.pending-reclaim
--i-approve-destructive-reset --i-accept-test-fund-loss`. Run
`2026-07-13T05-14-34-351Z-a74ca7c0` funded 100 sats, created a 40-sat pending
token, proved the wallet at 60 sats with a -40 delta, and exercised Check Status
through its rendered pending toast. It reopened the action menu, cancelled the
token, proved token-data removal and a `rolledBack` transaction, restored the
wallet to 100 sats with a zero net delta, and reopened the detail to verify the
persistent `Cancelled` / `Funds returned to your balance` state. Raw QA
screenshots captured the pending and reclaimed states; exact host sweep and
reconciliation restored the app to zero and cocod exactly
`2882 → 2782 → 2882`, with zero fees, before the owned simulator was deleted.

`send.token.actions` has now executed as funded product evidence. Run it with
`bun run shots -- --suite full --scenario send.token.actions
--i-approve-destructive-reset --i-accept-test-fund-loss`. Run
`2026-07-13T05-48-53-705Z-9486e246` funded 128 sats and created a pending
63-sat token. It proved exact raw-text copy and an emoji copy that decoded back
to the same token, detected and dismissed the current-iOS native share sheet,
and changed the QR controls from Medium to Slow and Heavy to Light. Check Status
produced the rendered pending toast; Cancel then removed the token data, changed
the transaction to `rolledBack`, restored the wallet to 128 sats with zero net
delta, and persisted `Cancelled` / `Funds returned to your balance` after the
detail was reopened. The run finished on the wallet, swept the app to zero,
reconciled cocod exactly `2882 → 2754 → 2882` while Minibits remained at 1331
sats, and deleted the owned ephemeral simulator.

`send.lightning.sat` has now executed as funded product evidence. Run it with
`bun run shots -- --suite full --scenario send.lightning.sat
--i-approve-destructive-reset --i-accept-test-fund-loss`. Run
`2026-07-13T06-07-18-450Z-fa39bfff` used the repaired bounded 100-sat funding
handoff and native-visible Paste selector, previewed and paid a controlled
40-sat invoice, and proved the product `PAID` state before cocod reported
settlement. The app delta was exactly -40 with no fee; host recovery swept the
remaining 60 sats, reconciled the final wallet to zero, and restored cocod
exactly `2882 → 2782 → 2822 → 2882` while Minibits remained at 1331
sats. The owned ephemeral simulator was then deleted.

`send.lightning.dismiss` has now executed as funded product evidence. Run it
with `bun run shots -- --suite full --scenario send.lightning.dismiss
--i-approve-destructive-reset --i-accept-test-fund-loss`. Run
`2026-07-13T06-42-23-795Z-ae2d2f7a` funded 100 sats, opened a controlled unpaid
40-sat invoice as a synthetic preview, and used Cancel without exposing Pay or
settling the invoice. Raw QA screenshots captured the preview and unchanged
wallet; the app retained a zero net delta and no melt history row. Host recovery
swept the untouched 100 sats, reconciled cocod exactly
`2882 → 2782 → 2882`, and deleted the owned ephemeral simulator.

`payment.request.delivery-rollback` has now executed as funded product evidence.
Run it with `bun run shots -- --suite full --scenario
payment.request.delivery-rollback --i-approve-destructive-reset
--i-accept-test-fund-loss`. Artifact
`run-2026-07-13T07-24-44-653Z-3cf0239f` passed in 329.8 seconds after funding
100 sats from cocod over Lightning. A deterministic 30-sat NUT-18 delivery
failure moved the structured preview from `prepared` to `rolledBack`; the live
screen showed `Delivery failed — funds returned to your balance`, and the
reopened persisted detail remained `rolledBack` with `Funds returned to your
balance`. Raw unmasked screenshots captured every step. The app reconciled
`0 → 100 → 100 → 0`, host cleanup swept the untouched 100 sats, and cocod
reconciled exactly `2882 → 2782 → 2882` with zero fees and zero residual before
the owned ephemeral simulator was deleted.

`tx.source.cashu-paste` has now executed as funded product evidence. Run it with
`bun run shots -- --suite full --scenario tx.source.cashu-paste
--i-approve-destructive-reset --i-accept-test-fund-loss`. Artifact
`run-2026-07-13T07-31-13-536Z-a311d9b7` passed in 256.8 seconds. Cocod created an
exact 50-sat Sovran-mint token; the app preview proved
`in` / `50` / `sat` / Sovran mint / `prepared` with no source before redemption.
Redemption produced a different final transaction id whose structured probe was
`in` / `50` / `sat` / Sovran mint / `finalized` / `paste`. The rendered detail
showed `Source` / `Clipboard` both immediately and after reopening its wallet
row. Raw unmasked screenshots captured every step. The app moved
`0 → 50 → 0`, cocod reconciled exactly `2882 → 2832 → 2882`, and cleanup
recorded 50 sats recovered with zero residual and zero fees before the fresh
ephemeral simulator was deleted.

The funded lane now has an approved, deliberately narrow boundary:

- simulator creation/deletion needs `--i-approve-destructive-reset`, while value
  movement independently needs `--i-accept-test-fund-loss`;
- each funded scenario still owns a fresh ephemeral simulator and isolated
  Metro/serve-sim processes;
- cocod is the black-box SAT counterparty, intentionally using the operator's
  current low-value `~/.cocod` wallet. The runner pins one absolute binary
  (`COCOD_BIN`, otherwise `${HOME}/.bun/bin/cocod`), permits only `0.0.16`,
  requires `UNLOCKED`, records its metadata, and never invokes `cocod history`;
- authored JSON names typed semantic operations instead of argv: Cashu create/
  redeem, BOLT11 create/pay/settled, Lightning-address resolve/pay, and
  `recovery.sweep`;
- the freshly generated app mnemonic crosses only an authenticated, random-token
  HTTP endpoint bound to `127.0.0.1` for the owned Metro session. It never enters
  console/Metro output or evidence, and it plus any controlled P2PK private key
  is stored only in mode-`0600` recovery custody; artifact directories are mode
  `0700`;
- `recovery.sweep` runs NUT-13 restoration on the host for each declared exact
  mint/unit/account asset, sends the maximum spendable value after fees back to
  cocod, and never asks the UI to send a guessed cleanup amount;
- every cocod operation has an exact before/after observation. Final balance must
  equal baseline plus the ordered deltas before private custody is removed;
- one global mode-`0600` lock serializes funded runs. On startup, a stale lock is
  recoverable only by resuming durable custody, reconciling and re-probing every
  liability, and passing a clean audit; uncertain, corrupt, unreachable,
  `PENDING`, or residual states fail closed;
- a prepared app Cashu outflow is inspected before any new value effect. Fully
  `UNSPENT` tokens are retried once, already-credited `SPENT` tokens repair their
  accounting idempotently, and `PENDING`, mixed, or partial/excess/negative
  balance-drift results retain custody and block. Only an exact full credit is
  attributable;
- raw screenshots are pre-created `0600` inside randomized `0700` temporary
  directories, removed in `finally`, and bracketed by direct one-shot AX frames.
  They are written unmodified by default as QA evidence, so token, invoice,
  address, and profile data may be visible and the artifact directory must not
  be shared. The optional JSON `mask` field remains available; when a checkpoint
  opts in, authored and automatically detected sensitive regions are blackened.

This design explicitly acknowledges that a process crash can still lose test
funds. A `SPENT` prepared token with exactly no cocod credit may become terminal
`spent-uncredited` only when the separate loss flag was supplied; the ledger
records that accepted principal loss before recovery sweeps the remainder. The
flag never authorizes replaying an ambiguous token or attributing unrelated
balance drift. The design does not pretend the current cocod wallet is isolated.
The boundary is now proven by the named `send.cashu.sat`,
`receive.lightning.sat`, `receive.cashu.paste`, `receive.cashu.dismiss`,
`toast.receive-lightning`, `send.cashu.pending-reclaim`, `send.token.actions`,
`send.lightning.sat`, `send.lightning.dismiss`,
`payment.request.delivery-rollback`, and `tx.source.cashu-paste` product runs.
Each proof promotes only its named scenario. Remaining `deferredReason` gates
stay authoritative until separately promoted and executed.

The pending-toast assertion is also render-bound: a DEV-only marker is mounted
beside the real HeroUI toast component and mirrors only its closed static key into
the ordinary AX tree. Calling `staticPopup` alone cannot satisfy the scenario.
Payment-status assertions use equivalent render-bound lifecycle markers and an
exact retained View callback rather than treating notification state as rendered
evidence.

Action-menu readiness is presentation-bound as well as render-bound. The DEV
probe records the current popup `openSeq` when the real FullWindowOverlay body
mounts and exposes readiness only after the native sheet reports an open snap
point for that same sequence. Closing and reopening a menu therefore cannot reuse
the previous marker during its exit animation and send a coordinate tap through
to the route underneath.

The approved JSON-native core owns schema validation, compact-format enforcement,
suite selection/order, fixture expansion, semantic phases, redaction, structured
events/reporters, offline smoke orchestration, owned simulator sessions, typed
funded effects, mode-`0600` custody, a durable quarantine-first liability
contract, and exact cocod accounting. These contracts and their focused tests are
not by themselves product evidence; only a separately authorized named device
run is. The core is
**not** built by wrapping the `.sov` runtime. The old authoring format is retired
without a compatibility layer; legacy cases may inform coverage research, but
full `.sov` parity is neither claimed nor required by this slice.

JSON planning and fake-driver orchestration have four visible phases. Reusable
prerequisites are `Pxx` (`precondition`), the user behavior under test starts
explicitly at `Txx` (`test`), the authored verification section is `Vxx`
(`verify`), and cleanup is `Cxx` (`cleanup`). Mid-flow assertions remain `Txx`
when more product behavior follows; phase is never inferred from action type.
Fixture provenance stays visible in logs. A
scenario beginning does not imply that its tested behavior has begun; the
reporter must print the test boundary after prerequisites complete.

`full.json` is the complete authored-scenario index, including deferred work;
`default.json` is deliberately smaller and unfunded. Suite order remains
editorial outside an explicit `newInstance: false` reuse group. Selecting
`recovery.reinstall`, for example, includes its preceding onboarding prerequisite
and runs both in their declared order on one owned ephemeral simulator. The
grouping and selection contracts can be proved offline, but recovery remains
without product evidence until that named grouped simulator run passes. A
deferred scenario is valuable because it makes missing coverage visible, but it
provides no product evidence until separately authorized and executed. See the
section 5/11 matrix before interpreting a green validation or fake-driver run.

## Agent-device adoption

[`agent-device`](https://agent-device.dev/) is a possible future exploration and evidence layer. It uses the native
accessibility tree, semantic refs/selectors, screenshots, recordings, logs, and
replay scripts. That matches the Design System well: open one deterministic
family, select a scenario, capture its accessibility snapshot and image, then
move to the next scenario without depending on a funded wallet.

No agent-device installation or replay is part of the approved JSON slice.

Adoption order:

1. Expand the Design System catalog until the inventory's high-value shared
   components are covered.
2. Add stable route/scenario selectors and a device-only scenario navigator.
3. Install and verify `agent-device` locally, then record a Design System replay
   that captures screenshots and video under `.device-artifacts/`.
4. Reuse the approved ephemeral-device and funded-counterparty lifecycle; seek a
   new decision only when an adapter would broaden that boundary.
5. Port only the highest-value functional flows to an agent-device adapter if it
   proves useful. JSON remains the human-authored regression format; any adapter
   consumes the same scenario/lifecycle contract and adds no second DSL.

No Maestro expansion is part of this phase.

## Aggregate verification without runner collapse

The project needs one summary command, not one universal runner. It should invoke
wallet Vitest, app Jest, JSON validation, and authorized harness checks as
separate jobs, preserve each layer's result, and print the coverage-ledger status.
Simulator and funded-device lanes remain separate jobs. The report must not
describe offline planning, fake smoke, or focused recovery tests as proof of
native navigation, rendered toasts, or a completed live value cleanup.
