# Sovran testing strategy

Sovran has four different test jobs. They should share fixtures and scenario
names, but they should not be collapsed into one runner.

The implementation checklist and upstream gaps live in
[`testing-roadmap.md`](./testing-roadmap.md).

| Lane                        | Owns                                                          | Current entry point                                            |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Pure and contract tests     | Funds math, codecs, persistence, state machines, hooks        | `bun run test`, `bun --cwd wallet run test` from the workspace |
| Exact structural snapshots  | Stable rendered output for reusable components                | `bun run test:design-system`                                   |
| Deterministic visual checks | Native rendering of the Design System on a simulator          | Design System routes; device runner pending                    |
| Functional wallet flows     | Real navigation and value transfer with a counterparty wallet | `bun run log-doctor -- phone test …`                           |

The first two lanes must stay offline and deterministic. The latter two may use
a simulator and `cocod`, but must never reuse a developer's funded app wallet.

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

Tracked camera fixtures must be deterministic and non-payable. Live invoices,
Cashu tokens, or payment requests are generated per run under ignored
`.device-artifacts/`; see `scripts/serve-sim/README.md`. The preview remains
bound to `127.0.0.1` because its control surface can execute simulator actions.

## Deterministic device runs

The stable unit of isolation is a **run**, not a hard-coded seed or balance.
Every future functional run should have a run id and this lifecycle:

1. Confirm the target is the development bundle (`com.sovranbitcoin.dev`).
2. Create or reset a dedicated simulator app data container. First launch then
   creates a new app mnemonic; never inject a fixed production-like mnemonic.
3. Set `SOVRAN_TEST_COCOD_HOME` to the run's ignored counterparty directory and
   start that dedicated test `cocod`. Never use a personal `~/.cocod` wallet
   implicitly; the DSL maps only cocod's child environment to the isolated
   HOME/socket/pid.
4. Record starting balances per mint and a maximum fee budget in the run ledger.
5. Fund the app only with the amount needed by the scenario. Assert balance
   **deltas**, captured transaction ids, and terminal states—not absolute wallet
   totals or literal invoices/tokens.
6. Let the app create invoices/tokens when testing sends; let `cocod` consume
   them. Reverse those roles when testing receives.
7. Sweep remaining app ecash back to the test counterparty per mint. Reconcile
   starting balance, ending balance, returned funds, and declared fees.
8. Delete the app container and run secrets only after reconciliation succeeds.
   A failed sweep quarantines the simulator/container and ignored ledger for
   recovery; it must never silently destroy the only seed for stranded funds.

Lightning and on-chain tests are not exactly value-conserving because real fees
exist. Their assertions use an explicit fee envelope. Ecash-only round trips
should conserve value apart from declared Cashu input fees.

The existing Sovran Test DSL already supplies semantic `testID` selectors,
dynamic-value capture, snapshot scrubbing, screenshots, and `cocod` commands.
It remains the owner of repeatable wallet flows. A lifecycle coordinator should
wrap that runner later; it should not be reimplemented inside each `.sov` file.

## Agent-device adoption

[`agent-device`](https://agent-device.dev/) is the future exploration and evidence layer. It uses the native
accessibility tree, semantic refs/selectors, screenshots, recordings, logs, and
replay scripts. That matches the Design System well: open one deterministic
family, select a scenario, capture its accessibility snapshot and image, then
move to the next scenario without depending on a funded wallet.

Adoption order:

1. Expand the Design System catalog until the inventory's high-value shared
   components are covered.
2. Add stable route/scenario selectors and a device-only scenario navigator.
3. Install and verify `agent-device` locally, then record a Design System replay
   that captures screenshots and video under `.device-artifacts/`.
4. Add the isolated app-wallet / dedicated-`cocod` lifecycle coordinator.
5. Port only the highest-value functional flows to agent-device replay. Keep the
   existing DSL as the human-authored regression suite; agent-device complements
   it for exploration, debugging, and evidence.

No Maestro expansion is part of this phase.
