# Persistence fixtures: broader coverage without per-change simulator runs

Research date: 2026-11-12. Candidate inspected: `surgery/decisions-1` at `d39ae2f7c`; main remains
`e5d70b590`. This is a research proposal, not an implemented test framework or release-safety verdict.

## Recommendation

Extend the existing historical-disk runner with historical value generators, field/variant obligations,
independent preservation facts, and deterministic failure schedules. Keep the existing release fixtures,
provenance and real Coco databases. Most JavaScript compatibility checks can run in CI without simulators.
Neither a fixture corpus nor generated tests can guarantee coverage of every possible stored value or native
failure. A passing JavaScript suite should be a distinct result from native storage verification.

Cover every installable release/build through an explicit mapping to a durable compatibility contract. Do not
copy an entire disk fixture for every app version when the relevant writer, format, key scope and backend
semantics are unchanged. Distinguish app version, persisted-store version and storage-library version. A shape
remaining unchanged does not prove that writer semantics stayed unchanged. Unversioned additive fields also
need obligations; this proposal does not override Sovran's rule against unnecessary store version bumps.

## What Sovran already has

The candidate has twenty epoch fixtures. The current build starts directly on each old disk three times,
uses real global migration and store hydration logic, opens account keys, writes the persisted stores and
switches accounts. Historical stored examples are hash-pinned. The completeness gate requires release/epoch
coverage and a populated example or justification for each current store. See
[fixture principles](../../../sovran-surgery/app/__tests__/releaseFixtures/README.md),
[the actual launch runner](../../../sovran-surgery/app/__tests__/releaseFixtures/launch.ts) and
[completeness checks](../../../sovran-surgery/app/__tests__/releaseFixturesCompleteness.test.ts).

The exact gap is inside each store. Completeness currently requires a fact for each populated store, not one
for every persisted field and enum alternative. The generic round-trip guard explicitly covers initial values
only. Targeted tests cover some historical writer limits, unresolved restore states, partial migration writes,
and preservation failures, but there is no shared property/schedule campaign over historical states.

Historical Zustand rows were generally authored by reading old source, not captured by executing every old
release. Freezing their hashes prevents accidental rewriting; it does not establish exhaustive historical
accuracy. E20 combines current-upgrade output with manually populated new fields. Coco's database fixtures do
come from old adapter packages and already run through the actual adapter and application open path on Node
SQLite. That evidence covers real database files without pretending Node is the native Expo SQLite module.

Evidence locations at the candidate:

- `app/__tests__/releaseFixtures/index.ts:24`, `releaseFixtures/README.md:23`, `E19-0.1.2.ts:22`,
  `E20-0.1.4.ts:100`: inventory, provenance, and generation boundaries.
- `app/__tests__/releaseFixtures.test.ts:56`, `releaseFixtures/launch.ts:211` and `:286`:
  direct candidate upgrades, actual load path, account switching and writeback.
- `app/__tests__/releaseFixturesCompleteness.test.ts:265` and `:282`,
  `persistRoundTrip.test.ts:12`, `persistSchemaDrift.test.ts:149`: maintenance gates and their limits.
- `app/__tests__/releasedWriterBounds.test.ts:9`, `releaseFixtureRestoreInFlight.test.ts:9`,
  `globalMigrationsRunner.test.ts:89`: selected boundary and failure cases.
- `app/__tests__/cocoDatabaseUpgrade.test.ts:5`: authentic old SQLite files and host/native distinction.

## Primary-source precedents

**Zustand itself.** Its async persistence tests provide stored JSON envelopes with old versions, hydrate actual
stores, check migration output and writeback, and test read/migration failures and concurrent hydration.
The current implementation passes the stored version to the current migrator on mismatch; it does not
load a succession of historical app releases. Its shallow merge can discard nested defaults, so migration-only
tests miss part of the contract. These are focused middleware tests, not proof of every historical mobile
state. [Actual tests](https://github.com/pmndrs/zustand/blob/9fed2eb2f3af672da9f7bf694b996df3831fc207/tests/persistAsync.test.tsx),
[persist implementation](https://github.com/pmndrs/zustand/blob/9fed2eb2f3af672da9f7bf694b996df3831fc207/src/middleware/persist.ts),
[official guide](https://github.com/pmndrs/zustand/blob/9fed2eb2f3af672da9f7bf694b996df3831fc207/docs/reference/integrations/persisting-store-data.md).

**Redux Persist.** Its TypeScript `createMigrate` tests assert ordered steps, awaiting asynchronous steps,
starting after the inbound version, and propagating errors. This is a useful example for checking migration
composition. It does not replace tests of actual storage, hydration or domain meaning.
[Tests](https://github.com/endograph/redux-persist/blob/9e0661ebd4ef7ed0d2bd183edfc018a38d2da16d/tests/createMigrate.spec.ts).

**Dexie.** Its JavaScript upgrade tests create older databases, insert records, close and reopen with newer
versions, and check both migrated contents and operational indexes. This is a close precedent for testing the
whole persistence boundary instead of merely calling a converter.
[Upgrade tests](https://github.com/dexie/Dexie.js/blob/95666bf5370a222a21d7f53130d87b42e9b7bac7/test/tests-upgrading.js).

**RxDB.** Its TypeScript migration suite includes reopening after migration and rejecting a migration whose
result violates the destination schema. The same file tests interactions and cancellation beyond a single
happy-path data sample. These are storage-library examples; no reviewed source claimed exhaustive per-release
Zustand or React Native application coverage.
[Migration tests](https://github.com/pubkey/rxdb/blob/master/test/unit/migration-schema.test.ts).

**fast-check.** The existing app dependency supplies generators with shrinking, reproducible seeds, command
sequences, and scheduled asynchronous execution. Its documentation explicitly warns against a model that copies
the implementation. A scheduler only controls the asynchronous operations placed under it; it is not a real
power-loss or filesystem simulator. [Generators](https://fast-check.dev/docs/core-blocks/arbitraries/),
[configuration](https://fast-check.dev/docs/configuration/),
[model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/),
[race scheduling](https://fast-check.dev/docs/advanced/race-conditions/).

**Testing the tests.** StrykerJS demonstrates mutation testing for JavaScript/TypeScript. We can initially use
explicit broken variants in throwaway copies, without installing it: delete a field, overwrite a value with its
default, choose another account key, or mark migration complete before writing. The corresponding preservation
test must fail. Mutation scores are evidence about tested faults, not proof of absence of all faults.
[Mutation testing](https://stryker-mutator.io/docs/),
[supported mutations](https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/).

## Proposed extension

### 1. Historical contracts, not an enormous directory of snapshots

For each distinct historical persisted contract, describe its raw storage envelope and key scope, its supported
writer outputs, representative valid states, and independently stated facts that must survive. Share it across
releases only with evidence of equivalence. Test-only contracts belong beside the existing fixtures, not in
production stores. Keep corrupt, mixed-version and unreachable adversarial states in separate categories so
failure reports distinguish losing valid old data from correctly refusing damaged input.

For existing history retain the source-cited fixtures rather than rebuilding all releases. Add missing cases
where the audit finds a real hole. For future releases capture raw storage through the actual production write
path and freeze it with source/dependency provenance. Generate broader inputs using the historical writer's
contract or actions where executable; do not generate old inputs from today's stricter schema. Several old
writers could write values their own readers rejected, as the existing bounds tests demonstrate.

### 2. Required deterministic cases plus generated exploration

Require explicit cases for each finite variant and each meaningful boundary: optional missing, null where
supported, false, zero, non-default values, nested absent fields, empty/one/many entries, duplicate identities,
string and collection size boundaries, every operation phase, and legacy encodings. Run small interacting state
clusters exhaustively when affordable. Use constrained pairwise/higher-order combinations elsewhere and
explicit full interaction cases for money/account/recovery risks. Pairwise coverage is not a blanket guarantee;
[NIST describes it as a cost-reducing testing method](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software).

Then run seeded generated valid historical states through the same runner. Preserve shrunk failures as permanent
regression examples. An object with all fields populated is insufficient: it misses absence, alternative variants,
conditional serialization and transitions. Even fifty independent booleans have over a quadrillion combinations;
strings, collections and operation histories make enumeration impractical or unbounded.

### 3. Define what “makes sense” means independently

Parsing successfully is insufficient: an empty reset store can parse. For each case compare protected domain
facts before and after the whole upgrade, writeback and cold restart. Examples: original account/key identity,
selected settings, retained history entries, unchanged proof ownership and amounts in the actual wallet database,
nondecreasing derivation counters, and a recoverable pending operation that has not executed twice. Record permitted
transforms or cache expiry explicitly rather than demanding byte-for-byte equality of everything.

Valid historical data must satisfy its preservation obligations. Malformed input must meet a separately defined
safe outcome, such as preserving unreadable bytes and refusing to proceed; this research does not choose new
product recovery policies. The expected result must not come from rerunning the same migration or blindly
accepting its output as the new snapshot.

### 4. Exercise the real upgrade path, and selected historical paths

Prioritize every old format directly into the candidate, because users skip installed releases. Use actual
hydration, schema validation, defaults, merge, account-scoped keys and writes, not only `migrate()`.

Also compare important installed intermediate-release routes with the direct route. To test old → intermediate
→ current, run that intermediate release's actual frozen persistence behavior; calling today's migrator
repeatedly is not equivalent. Compare protected facts, allowing legitimate release-specific defaults and business
changes. Exhaustively enumerating every possible installed-release path is unnecessary for an initial useful gate;
choose all structurally distinct conversion edges and historically risky compositions, and report the bound.

### 5. Fault and schedule campaigns

Extend the test storage adapter to record operations and inject fail-before, persisted-but-reply-lost,
truncated/corrupt-read, delayed-read, reordered-completion and restart-after-write cases. Restart using fresh
module state and the durable bytes that survived; do not reset storage together with memory. Include a write
arriving during hydration, account switching during load, a migration interrupted before its completion marker,
and repeat startup. Assert recovery/no-loss/ownership invariants after each selected interruption. Only claim
coverage of explicitly modeled failures; actual backend atomicity is a separate question.

### 6. Make future changes straightforward for an agent

Reuse the generated store registry and schema drift gate. Add a test-only coverage check that names the exact
field, variant, writer branch or invariant whose obligation is missing when persisted behavior changes. Optional
fields with unchanged version numbers must still trigger it. Include `partialize`, key scope, serializer,
validation/defaulting and relevant storage-dependency changes; schema shape alone is not enough. A source hash can
request review, but cannot prove semantic coverage automatically.

An agent workflow should be: inspect the diff and affected contracts; scaffold missing cases; author the
preservation fact; demonstrate a broken variant fails; run fast deterministic/seeded checks; inspect the report.
Current schemas may scaffold new obligations, but must never overwrite frozen history or manufacture both input
and expected output. Require review of exemptions and preserved-fact changes. Keep the existing upgrade command
as the entry point, with fast per-change checks and larger separately scheduled campaigns. This is a proposed
workflow, not an additional CLI already implemented in the repository.

## What this cannot establish without native evidence

The AsyncStorage project's own Jest documentation says it replaces an unavailable native module with an in-memory
implementation. That supports CI testing of JavaScript behavior, not the physical backend. Expo documents
platform-specific SecureStore uninstall, accessibility and backup behavior. Those properties require separate
native tests; mocked results cannot establish them. [AsyncStorage Jest documentation](https://github.com/react-native-async-storage/async-storage/blob/eaa7b60f834d31fb422787c7723081a4dff93de8/docs/integrations/jest.md),
[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).

Retain a smaller native verification layer for storage/native-library changes, native configuration, keychain and
Keystore behavior, backup/restore, and representative upgrade smoke tests. A proposal to change release policy
would need its own owner decision; this investigation does not waive the existing persistence skill. Native tests
also cannot cover every state. The defensible claim is explicit, reproducible coverage with named remaining gaps.

## Verification and outcome of this investigation

- Refreshed EAS history with `python3 .agents/skills/persistence-release-safety/epochs.py builds`: succeeded,
  456 installable store-build rows, no change to the tracked TSV. Build eligibility is not proof of store rollout.
- Independent GPT-6.1 Sol repo audit ran completeness, frozen-fixture and current default round-trip tests:
  three suites, 116 passed, one skipped. Log: `/tmp/fixture-audit-focused.log`.
- Primary source files and documentation above were read; external test suites were not executed. The full
  upgrade suite was not rerun for this research. No exhaustive state-space, crash simulation or native run was made.
- Fable 5.2 medium research delegation failed due Claude API rate limit. GPT-6.1 Sol performed the research and
  the separate repo audit; no cross-provider design review or persistence PASS is claimed.
- Behavior changed: none. Product code, stored formats, migrations and frozen fixtures are untouched. The proposed
  extension is awaiting owner approval before implementation; no project dependency was added and nothing was published.
