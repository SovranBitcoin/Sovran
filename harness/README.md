# Task harness

A first implementation of a local, persistent controller for task work through T3. The controller owns the sequence;
workers submit observations and evidence. Host shell access is trusted, not sandboxed.
Task state belongs outside the source checkout, under `~/.local/state/sovran-harness` by
default (`SOVRAN_HARNESS_STATE` overrides it). It contains private local evidence; do not
commit or publish the database or raw logs.

The JSON CLI and MCP server share one protocol, defined in `src/protocol.ts`.
Run `bun run harness request.json`, or pipe a request to `bun run harness -`.
`bun run harness mcp` serves the same operations over stdio using the official MCP SDK.
The controller never merges or deploys.

The [reliability research and proposed model policy](../docs/research/full-send-reliability.md)
define the next improvements. They distinguish approved choices from gates implemented here.

Use the repository's `full-send` skill from an existing T3 conversation. It performs the
initial multiple-choice intake and drives the JSON controller with T3-owned child tasks.
That works through the host when the conversation is viewed on an iPhone; no mobile build
or background iOS agent is installed. The MCP server is an optional interface, not an
automatically registered T3 extension. Its schema is discoverable through MCP `tools/list`.

```mermaid
flowchart TD
  problem[Problem and research] --> intake[Initial questions and sealed contract]
  intake --> implement[Implement with relevant skills and pinned sources]
  implement --> verify[Run checks and preserve raw evidence]
  verify --> review[Independent model reviews code and outputs]
  review --> adversary[Adversarial counterexamples]
  adversary --> audit[Saved-check retrieval and final judgment]
  audit --> diversity{Cross-provider review established?}
  diversity -->|Yes| publish[Publish exact reviewed head]
  diversity -->|Approved GPT fallback| extra[Extra GPT review outside every author model]
  extra --> publish
  publish --> ci[Required CI and merge-policy checks]
  ci --> ready[Ready PR: owner merges]
  verify & review & adversary & audit & extra & ci -->|Verified defect, within budget| implement
  verify & review & adversary & audit & ci -->|Missing evidence or exhausted budget| incomplete[Incomplete with evidence gap]
```

## Sealed authority

Scope uses repository-relative files or directory prefixes, not globs. Dependency allowances
name exact `package@specifier` strings. Override/catalog/patch policy changes use the exact
`manifest:path#section=JSON` value; lockfile changes require `lockfile:path@sha256`.
Resolve planned dependency changes in a disposable preview before intake so the owner can
approve the resulting allowance. Unexpected dependency needs stop work without a mid-run
question. Deletions still have to satisfy scope and tests.

New routed tasks seal a `historyPolicy` with exact planned paths within their authorized
scope. Before a writer starts, the controller captures baseline Git blobs, blame and up to
eight path-specific changes. Research records each protection, its preservation plan,
and evidence or gaps for changes, callers/tests, PRs and follow-ups. This is bounded
retrieval, not a complete explanation of intent. Follow older commits and discussions where
relevant. Final audit rechecks every changed path; an uninvestigated path cannot be accepted.
If another path becomes necessary, this version requires a new prepared task rather than
backdating research or silently changing the sealed plan. Old records stay readable without
claiming this stronger history coverage. Historical citations can name removed files at an
exact ancestor revision.

Context is copied before execution, with hashes. Per-role briefs point at existing skills,
including the navigation document's reason for `-flow` wrappers. They do not replace those
rules with another standards catalogue. Relevant external files are pinned by commit under
`/tmp/sovran-harness/references/<owner>/<repository>/<commit>` and copied into private task
evidence. A missing or dirty cache is refused, never silently reset. Upstream content is
reference material, not task authority. No upstream repositories are cloned until selected.
The [project catalog](src/references.ts) owns verified origins; already sealed snapshots keep
their recorded origin when the catalog changes.

PR authority pins repository, push URL, branch, base revision and required CI check names.
Publication needs a clean checkout at the tested source, starting from the sealed PR base.
Unknown outcomes reconcile the existing branch/PR and may repeat identical metadata updates.
A missing PR after an uncertain request does not authorize another
create. A base changing after verification invalidates integration evidence. The publisher
never force-pushes, merges, enables auto-merge, or deploys.

CI requires both the sealed check names and current server requirements. Raw GitHub rollup
pages preserve competing attempts and publisher identities; a newer failed or pending run
cannot borrow an older pass. Actions run association must match the PR's head and base.
Every completed observation, including waiting, is retained for later diagnosis. Unavailable
policy, incomplete pages, ambiguous publishers, skipped checks or stale revisions cannot
certify readiness. This currently supports head-attached checks; merge-only receipts and
protected branches whose classic policy cannot be read remain incomplete. Run association
and a trusted workflow are bounded integration evidence, not attestation of arbitrary CI code.
See [GitHub's check objects](https://docs.github.com/en/graphql/reference/checks) and
[effective branch rules](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch).

## What a transition proves

The initial contract records outcomes, scope, commands, models, allowed dependencies and
a deadline. Research precedes sealing. A worker must claim its exact ticket before submitting;
another worker cannot take over merely because time passed. Completion means that worker
and its child processes have stopped. Unknown outcomes require reconciliation, not replay.

Verification runs the agreed command arguments without a shell. Plain commands establish
process results only. A `node-tests` check seals exact files and required case-name paths;
the host collector uses Node's process-isolated test API and retains its structured events,
stdout/stderr, runtime version, collector hash, selected file hashes and invocation identity.
Empty-file wrappers, skipped/todo required cases, missing cases, inconsistent lifecycle or
summary counts and incomplete streams fail the check. Printed JSON is captured as test
stdout, never interpreted as runner evidence. This is not authentication of hostile test
code: Node's child protocol can be forged with binary writes to stdout, and workers share
the trusted host. Review the test inputs and runner changes independently; the collector
establishes consistency of Node's reported cases, not that arbitrary code honestly registered
or asserted them. This adapter has been exercised with Node
24.14.1; an unsupported event shape fails closed. See the official [Node test stream API](https://nodejs.org/docs/latest-v24.x/api/test.html#class-testsstream).
Execution evidence does not establish that assertions express the right behavior; independent
oracle review and a meaningful negative control remain necessary for important fixes.

Every command records its
output and the source fingerprint. A changed candidate invalidates evidence. Review and
adversarial review precede the final audit. An audit command completing is evidence only:
the audit worker must still judge it. The controller rejects skipped stages and missing
requirement observations. Qualitative judgments remain model judgments, not proofs.

Observations and findings must cite real repository files or registered, unchanged task
artifacts. Accepted research travels with its source and evidence identity into later briefs;
it describes what was learned before implementation, not proof about the changed candidate.
Initial review and adversarial review receive that context without other reviewers' verdicts.
The final audit then reconciles retained objections against the author's proposed resolutions.

Blocking findings keep artifact-qualified IDs across repairs. Negative assessments and failed
checks also remain obligations; a later pass cannot erase them. Implementation proposes a
fix or refutation with its hypothesis, experiment, disconfirming evidence and regression
evidence. The independent final audit must accept each exact proposal at the current source
and repair generation. An author cannot approve its own resolution, and blockers cannot be
deferred to make publication pass. These records establish accountability, not proof that
a model's diagnosis is correct.

Reviewers must submit observations for the actual hashed command artifacts. No controller
can prove a model understood a log; this gate makes missing or stale evidence visible.
T3's coordinator verifies model identity and terminal child state from tool results; a role
brief is not a provider system prompt or a technical tool restriction. The typed
[model policy](src/models.ts) owns the initial model choices and effort. Its live-catalog
snapshot establishes advertised support, not availability or effective effort. These choices
are evaluation hypotheses, not a ranking proven for this repository.

Routed contracts authorize a finite ordered availability fallback. A replacement needs a
terminal worker and no live children; it keeps the deadline, source, failed evidence and
all prior authors. Unknown dispatch outcomes retain ownership. Dispatch reservation grants
one caller permission to launch; a replay must reconcile the existing attempt. Negative
reviews enter repair, never model shopping. Old single-target contracts gain no fallback.
If the provider definitively rejected creation, the coordinator records that exact request
and provider error instead of inventing a child. An empty lineage search is insufficient.

Normal reviews must include a non-GPT review and cover every source-author provider with
a different provider. Otherwise the approved fallback requires an extra fresh reviewer using
a GPT model outside every source-author model across attempts and repairs. Normal review,
adversarial review and audit remain required. Missing eligible
models end incomplete. The PR discloses model attempts, fallback and unreported effective effort.

The SQLite transaction stores the transition and outstanding action together. An interrupted
command remains pending. Restarting does not silently rerun it. Immutable artifact writes are
idempotent, and reusing an operation id with different input is rejected. The database has a
version; an unsupported version is preserved and refused rather than reset.

Normal termination and timeouts kill the check's POSIX process group. A host/process crash
can leave unknown work: `reconcile-command` only releases a recorded group once it no longer
exists, and ends incomplete. A crash before its identity was recorded stays unresolved.
Deliberately detached descendants and arbitrary host shell actions remain outside this
trusted-host boundary. Use one shared state directory for all coordinators; separate journals
cannot coordinate ownership. Existing competing prototype rows remain readable but prevent
new work until reconciled; they are never deleted to make a migration pass.

## Persistence and native evidence

All application/wallet changes conservatively trigger the existing historical upgrade suite.
This includes feature-owned storage, not only `app/shared`. The controller discovers the
epoch inventory and Coco database manifest and checks ordinary assertions for the recorded
facts. Expected failures, missing cases, unexpected skips and known loss metadata cannot pass.
Existing historical check inputs and the upgrade command cannot change within the task they
certify; settle changes to that baseline before sealing. This deliberately favors false blocks
over silently dropping an old version from the test population.

A passing unit gate is bounded fixture evidence, never certification of every reachable
Zustand, Redux-era, SecureStore or Coco state. The existing persistence skill and ledger own
the wider state-space argument, including interrupted operations, skipped releases, restore
combinations, account types and platform differences. The controller does not reimplement
wallet migrations or Cashu behavior. Current known losses make this gate inconclusive.

Functional UI and performance tasks currently stop incomplete: the existing story/scenario
results do not bind their session to an installed binary on both platforms. Build-bound
captures establish visual evidence, not functional success. The producer integration and
required device validation are tracked in [F156](../docs/follow-ups/F156.md). This first
version must not be presented as production-ready autonomous wallet development.

## Development

`bun run --cwd harness test` exercises real SQLite, temporary git repositories and subprocesses.
`bun run --cwd harness type-check` checks this tooling independently of the shipped app.
The publication tests use a temporary bare Git remote and a fake GitHub executable; they
do not establish live GitHub readiness. The remaining complete live T3/GitHub pilot is
tracked in [F157](../docs/follow-ups/F157.md). No real-wallet, native or funded scenarios are part
of the tooling tests. Source-backed design references are in the
[ADR](../app/docs/adr/2026-10-16-task-harness.md).
