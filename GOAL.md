# Build, simplify and prove Sovran’s full-send PR creator

The result must let me describe a problem or feature in T3 Code, including from my iPhone,
answer a small initial set of multiple-choice questions, and then leave it working
autonomously until it produces a properly verified, ready-to-merge PR. I merge it myself.

Inspect and build on what already exists. Do not stop at another proposal, skill,
architecture diagram, or collection of Markdown files. Implement the missing behavior,
simplify the system, exercise it with real agents and real integrations, independently
review it, and fix the failures you discover.

Aim for expert-quality engineering supported by evidence. Do not claim that a system is
“the most expert,” universally safe, or guaranteed correct because models agree.
Demonstrate what it can reliably accomplish, what it correctly refuses to certify, and
where uncertainty remains.

## 1. Understand the existing work before changing it

Start in `/Users/kelbie/Documents/GitHub/Sovran/sovran-app`. Inspect the current branch,
worktree, status, `AGENTS.md` and applicable instructions. Preserve unrelated work. If
another session has changes, use an isolated worktree with the correct T3 workspace binding.

Read the existing harness, its tests, the full-send entry skill, the task-harness ADR, and
`docs/research/full-send-reliability.md`. Read relevant existing follow-ups, particularly
F149 and F156–F163 if they still exist. Follow closed entries through Git history rather
than assuming their disappearance means the concern vanished.

The last known research commit was `11388f9d3`. Treat that as a historical starting point,
not an assumption about the current checkout. Verify every claimed gap against current source.

Previously identified gaps included:

- Accepted research and unresolved knowledge not reaching later worker briefs.
- Finding evidence receiving weaker validation than observation evidence.
- Incorrect assumptions about Cashu repository origins.
- Model effort and approved availability fallback not being executable policy.
- Native functional evidence not bound to the actual installed binary.
- Story execution repeating a tap after missing feedback despite the action-once contract.
- Context routing pointing to an older native architecture without its superseding ADR.
- Missing complete live T3/GitHub validation and held-out agent evaluations.

Do not duplicate fixes that have already landed. Do not preserve a prototype merely because
we wrote it.

Use `jg` for behavioral discovery and reuse searches. If it is unavailable or incomplete,
record that and use focused source searches and history. Incomplete retrieval is not
evidence that nothing exists.

Recover relevant prior research and delegated results when accessible. Review my inputs
from approximately the last three months of relevant Claude and Codex conversations to
identify recurring problems. Reuse previous investigations before rescanning everything.
Treat my actual messages as preference evidence; assistant summaries are leads, not new
instructions from me. Keep private conversation contents out of public PRs.

Produce a concise inventory of:

- What works and has actually been exercised.
- What exists but has only simulated validation.
- What is merely proposed.
- What is duplicated, confusing or obsolete.
- What prevents a real task from reaching a trustworthy PR.

Then implement, rather than remaining in research.

## 2. Make the system understandable and structurally simple

The growing collection of Markdown files, skills, overlapping rules and complicated folders
is itself a problem to solve.

Give the system one obvious entry point and a small number of clearly owned components.
A new contributor should be able to answer:

- Where is the workflow defined?
- Where are model and effort choices defined?
- Where are task-specific requirements and permissions recorded?
- Where does evidence live?
- Why is this task blocked?
- How do I resume it?
- What must happen before a PR becomes ready?

Keep executable policy in a typed, validated source of truth. Skills should be thin
procedures or adapters where useful, not a second workflow engine. Documentation should
explain principles and usage, not mirror code or maintain competing status lists.

Consolidate or remove redundant task-harness documents and instructions. Preserve unique
rationale and source provenance before deleting anything. Keep unfinished work in the
existing follow-up ledger. Do not introduce a new parallel backlog.

Prefer deep modules with simple interfaces. Avoid one tiny file per concept, speculative
plugin frameworks, unnecessary wrappers, duplicated configuration, and “generic” abstractions
that make the actual workflow harder to follow.

Do not turn this into an unrelated rewrite of the wallet’s entire file structure. Improve
the harness and the interfaces it actually needs; record separate app-wide concerns appropriately.

Use XState and the official MCP SDK, which are already approved. Reuse Bun/SQLite and Zod.
Reuse existing public APIs and tooling before adding dependencies. Additional packages need
an explicit reason and the required authority; a research paper or skill does not authorize
installation.

I permit relevant local improvements to `../../hunch` when needed for this integration.
First inspect its current design and naming. Prefer its existing JevLint/public `jg`
interface. Do not reinvent retrieval, provider handling or a second semantic-lint engine.

## 3. Preserve the settled meaning of full send

Initial intake may ask a small number of multiple-choice questions, recommended answer
first, in plain language. Investigate facts yourself. Do not ask me questions that source,
history or available tools can answer.

Proactively identify the questions I have not thought to ask: compatibility, recovery,
authority, data retention, affected users, acceptable outcomes, test environments and
operational limits.

Do not ask again about decisions already settled:

- The endpoint is a ready-to-merge PR; I merge.
- Use the existing trusted T3 host.
- The host is not an OS security sandbox.
- XState and the official MCP SDK are allowed tooling dependencies.
- GPT-only completion during Claude unavailability is allowed under the additional-review
  policy below.

Before autonomous execution, settle scope, acceptance criteria, publication destination/base,
allowed dependencies and external effects, required evidence, model fallback policy and
finite task budgets.

After intake is sealed, do not ask the human more questions. Investigate, implement, verify,
repair and use preauthorized fallbacks. New evidence can inform implementation but cannot
silently expand authority.

A task needing new authority or unavailable essential evidence must report an honest
incomplete outcome, with useful resumable state. It must not invent permission, downgrade
an obligation, merge, deploy, or declare success.

Distinguish this product behavior from the goal of building the product: a correctly blocked
test case is valuable evidence, but a harness that simply blocks every real task is not a
finished PR creator. Keep working on all unblocked implementation and validation until the
success criteria below are met.

## 4. Make the controller own the workflow

The state machine must enforce meaningful transitions. Worker instructions alone are
insufficient.

The workflow should cover:

`understand → initial decisions → implementation → verification → independent review → adversarial review → final audit → publication → current CI/integration verification → ready`

Failures return to an appropriate diagnosis or repair stage, with evidence preserved.
Simplify or combine stages where that improves clarity without losing independent checks.

Persist task state, outstanding work, evidence, source identity, budgets and attempt lineage
so interruption or restart cannot skip stages or duplicate work.

Protect against:

- Two simultaneous writers.
- Duplicate dispatch after a lost response.
- Replacement workers starting before old workers are reconciled.
- Late results from obsolete attempts.
- Evidence from another source revision, task, binary or session.
- Unknown command or publication outcomes being blindly replayed.
- Empty, skipped, fabricated or partial checks being accepted as success.
- A worker’s claim of its own identity being treated as runtime attestation.

Preserve readable existing task records and their original authority. Do not reset journals
or silently give old tasks new permissions to make migration easier.

Use the actual T3 orchestration capabilities and lifecycle rules. Discover available models
from the live catalog. Use delegated tasks rather than ordinary top-level threads for child
work. Keep exactly one source writer per candidate.

Expose clear status and resumability through the existing T3 interaction, usable from the
phone while execution runs on the host. Do not claim an iPhone background agent exists.
Exercise the actual access path and clearly separate verified host behavior from any
untested mobile interaction.

## 5. Give every worker the context needed for its decision

Implement a practical account of what each worker knows, not a speculative simulation of
its internal thoughts.

Each worker should receive:

- Its specific responsibility and permitted actions.
- Original requirements, scope and authority.
- Relevant source, owners, conventions and skills.
- Historical reasons and behavior that must survive.
- Applicable upstream contracts and versions.
- Prior discoveries, failed experiments and unresolved findings.
- Required outputs and evidence.
- Explicit unknowns, contradictions and limitations.

Keep facts distinguishable as observed, inferred, disputed, unknown or superseded. Preserve
their sources and revisions. Research must actually reach implementation and review; do
not store it and then omit it from the next prompt.

Provide focused role instructions through the mechanisms the host supports. Do not label
an ordinary prompt as an enforced system prompt or tool restriction.

Independent reviewers should initially inspect original requirements, source and raw evidence
without being led by the author’s persuasive completion summary. Afterwards, reconcile
their findings against previous objections and evidence.

Keep context compact and relevant. Do not put every skill, repository and historical
conversation into every prompt. Test that important information survives restart, compaction,
repair and provider replacement.

## 6. Investigate history and existing follow-ups before editing

Git blame is essential, but last-modification attribution is not a complete explanation.

For changed behavior, inspect the relevant introducing/fixing commits, parent behavior,
callers, regression tests, ADRs, associated PRs and review discussions. Follow renames,
removed guards, reversions and superseding decisions when relevant.

Record in plain language:

“This exists because X can happen under Y; this change preserves that protection by Z.”

Distinguish recorded intent from inference. Missing history, unavailable PRs or incomplete
pagination must remain explicit gaps. Never manufacture certainty.

Review the final merged patch alongside old PR comments. A resolved thread does not prove
its concern was addressed; an early comment may describe code that never shipped.

Search both active follow-ups and relevant deleted entries in Git history. Classify related
work as:

- Required for this task.
- A prerequisite.
- Related but outside scope.
- Already resolved, with evidence.
- A suspected or verified recurrence.

Do not duplicate existing entries or revive obsolete IDs incorrectly. Do not defer an
in-scope acceptance failure just to get a PR green.

Recheck actual changed regions and follow-up relevance before completion. Newly touched
behavior needs the same investigation.

## 7. Prefer established Cashu behavior and preserve saved state

Use the relevant parts of:
`cashubtc/nuts`, `cashubtc/coco`, `cashubtc/cashu-ts`, `cashubtc/nutshell`, `cashubtc/cdk`,
`cashubtc/cashu.me`, Macadamia, Minibits and `cashubtc/wallet`.

Verify actual repository origins rather than assuming every project belongs to `cashubtc`.
Resolve local sibling paths from the real checkout, not from an arbitrary worktree’s relative
position.

Cache external references in deterministic owner/repository/revision paths under the task
reference area in `/tmp`. Reject wrong origins, dirty caches, partial retrieval and revision
mismatches. Preserve provenance and licenses. Do not scatter clones across the machine.

Select sources by relevance:

- NUTs for protocol requirements.
- Installed Coco/cashu-ts versions for actual APIs and ownership.
- Mint implementations for interoperability and recovery.
- Peer wallets for useful behavior and tradeoffs.

Peer implementations inform decisions; they do not override Sovran’s contracts.

For persistence work, use the existing release-safety procedures and historical fixtures.
Consider Redux-era state, Zustand, SecureStore, SQLite, Coco databases, accounts, skipped
releases, interrupted migrations, restored backups and partial operations.

Do not equate a passing fixture suite with proof of every possible real installation.
Identify supported state classes and unresolved coverage. Never erase data, remove historical
cases or tighten parsing to hide a migration failure. Do not assume reverting the binary
reverses a migration.

## 8. Make model routing explicit and evaluate it

Keep role, provider, exact model, effort, escalation and availability fallback in one
versioned policy.

Use the prior researched lineup as a starting hypothesis:

- Luna for bounded collection and extraction.
- GPT-6.1 Sol for implementation.
- Opus 5.5 for independent synthesis/review.
- Fable where adversarial analysis is useful.
- Astra for difficult questions and eligible additional reviews.

Resolve current model IDs and supported effort options from the live environment. Do not
invent availability or assume equivalent effort labels mean equivalent compute. Do not
claim one model is best without local evidence.

Fallback is for verified availability failures, not failing tests, negative reviews or
inconvenient conclusions. Reconcile interrupted work before replacement. Preserve all
attempts, authorship, partial edits and original budgets.

When completion lacks an eligible non-GPT independent review, require fresh GPT reviewers
plus an additional review using a different GPT model outside the complete set of models
that authored source during the task. That extra review cannot double-count as an existing
adversarial or final-audit slot. Disclose the fallback.

A Claude research step or failed Claude review does not waive that requirement. If no
eligible fallback exists, remain incomplete.

Compare model/effort choices on representative tasks at comparable budgets. Measure useful
outcomes, missed defects, false blocks, latency and cost. Treat high effort as a policy
choice to evaluate, not a safety guarantee.

## 9. Review different failure classes

Select review lenses according to actual risk, rather than launching many generic reviewers
who repeat each other.

Cover:

- Requirements and the actual user outcome.
- Historical intent and regression preservation.
- Simplicity, reuse, dependency necessity and file ownership.
- TypeScript/React/Expo correctness and relevant `-flow` structure.
- Test validity and evidence integrity.
- Payment, account, concurrency and recovery invariants.
- Persistence and compatibility.
- Security, privacy and hostile inputs.
- Native usability, accessibility, offline behavior and performance.
- Documentation, public claims and observability.
- Final integration, CI and PR accuracy.

Assign relevant existing skills and rules at the appropriate stage. Reviewers need concrete
triggers and consequences, not stylistic preferences disguised as blockers.

Challenge findings before fixing them. Look for guards or callers that invalidate a
reviewer’s theory. False findings and unnecessary edits are failures of the harness too.

Use Hunch/JevLint as focused evidence retrieval followed by explicit judgments. Incomplete
retrieval cannot become a clean audit. Make rule wording and results understandable, and
avoid replacing one opaque pile of rules with another.

## 10. Test the tests and the evidence producer

For important bug fixes, show the regression detects the intended old behavior and passes
on the candidate. A missing import, setup failure or compilation error is not a successful
reproduction.

Where old-code execution is inappropriate, use a valid alternative and a targeted deliberate
fault in a disposable checkout. Check that the fault is reached and represents forbidden
behavior.

Independently review changes to assertions, expected values, fixtures, mocks, snapshots,
selectors, skips, filters, runner scripts and budgets. Legitimate corrections are allowed
when justified by the requirement or history; matching a buggy implementation is not
justification.

Confirm required cases actually executed. A zero exit code, nonzero test count, coverage
percentage or plausible JSON report is insufficient by itself.

For E2E:

- Exercise the required user journey, not a convenient alternate route.
- Bind the run to the actual installed binary, source, scenario, platform and session.
- Inspect meaningful screenshots/video, raw logs and resulting state.
- Distinguish visible success from the underlying operation succeeding.
- Verify failure injection reaches the real path.
- Reset both wallet and private-mint state where required.
- Keep visual, functional and performance claims separate.
- Require actual platform evidence for platform claims.

Resolve the action-once contradiction in the native story runner without losing the original
need for reliable sheet readiness. Missing touch feedback cannot authorize another payment,
publish or delete. Prefer readiness before dispatch and bounded observation afterwards.

Preserve every test attempt. A pass after failure requires diagnosis; it does not erase the
failure. Distinguish application races, invalid tests, driver failures and environment failures.

Probe relevant ordering, concurrency, startup, teardown, timing and fixture contamination.
Choose repeat conditions before seeing outcomes. Finite clean runs do not prove zero flakiness.

Never use funded or production wallets for destructive or repeated experiments. Use disposable,
unfunded environments. Required GitHub checks remain required regardless of a model’s
classification of their failure.

## 11. Make repair loops earn their continuation

Each round must carry:

- Stable unresolved finding IDs.
- The violated requirement or invariant.
- The current hypothesis.
- A specific experiment or repair.
- Evidence that could disprove the hypothesis.
- Regression obligations that must remain intact.

After repair, rerun the relevant checks and required regression set, reassess applicable
risks, and review the cumulative diff. Changed source invalidates current passing receipts.

Do not shop for approving reviewers, delete objections, lower thresholds, weaken tests or
create endless abstractions to force success.

Repeated identical failures, oscillation or increasing complexity without new evidence
should trigger diagnosis or architectural reconsideration within scope. A different persona
or higher effort alone is not new evidence.

Use finite per-task repair/time/spend budgets. Exhaustion ends the task incomplete with
resumable evidence. Do not convert incomplete into ready or call this overall implementation
goal complete merely because the harness can stop safely.

## 12. Prove the harness with real tasks and adversarial cases

Test controller behavior separately from real-agent task quality.

Use real SQLite, Git repositories and subprocesses where practical. Exercise crash boundaries,
competing controllers, restart, ambiguous dispatch, late results, invalid evidence, source
drift, unknown publication outcomes and old task compatibility.

Create a small representative evaluation set from actual Sovran failures and clean cases.
Include:

- Correct no-change outcomes.
- Reuse instead of new code.
- Historical guard preservation.
- Context handoff.
- A false reviewer finding.
- Weak or misleading tests.
- Flaky evidence.
- Migration and recovery risks.
- Provider unavailability.
- Repair oscillation.
- Documentation and follow-up correctness.

Keep development cases separate from held-out cases. Historical evaluation workers must not
see future solution commits or answer-bearing caches. Validate the grader against both
known-bad and valid alternative solutions.

Measure false readiness and severe escaped defects first, but also false blocks and needless
work. A system that rejects everything is not useful.

Run complete live T3-to-GitHub pilots on small, legitimate, scoped tasks in controlled
branches. Exercise at least one useful ordinary task, one repair cycle, one restart/resume,
and availability fallback where live capability allows. Label simulated fault injection
distinctly from naturally observed outages.

Demonstrate a real PR containing the intended changes, truthful evidence and current required
CI. Do not fabricate task success or publish unrelated commits from the existing large branch.

Where native capability is advertised, validate the required native path and platforms. A
fake service test or screenshot-only run cannot close that obligation.

Do not remove a fail-closed guard until its replacement has meaningful evidence. Also do not
leave universally blocking placeholder gates and describe the product as finished.

## 13. Publication and completion

This goal is to deliver the working harness and prove its PR-creation capability. Establish
the exact repository, branches, base and safe pilot scope during initial intake. Publish
only those authorized, scoped changes and pilots. Never merge, enable auto-merge, deploy,
force-push or publish unrelated work.

Use small logical commits and required independent commit audits. Keep PR titles/descriptions
accurate after changes. Register every PR being worked on with T3 and use its watcher where
available. Reconcile ambiguous publication results rather than creating duplicates.

The goal is complete only when:

- The executable workflow owns the gates and durable state.
- The system is materially easier to navigate and reason about.
- Context and historical rationale survive actual handoffs and repairs.
- Model/effort routing and approved fallback are enforced and exercised.
- Checks establish meaningful behavior and preserve all failed evidence.
- Required review findings cannot disappear between rounds.
- Claimed native and persistence capabilities have appropriate evidence.
- Real delegated workers have completed representative end-to-end tasks.
- A live scoped PR has reached the verified ready state without merging.
- Independent review has challenged the implementation and verified fixes.
- Documentation clearly separates enforced behavior, evidence limits and remaining work.
- No unresolved issue undermines the capabilities being declared complete.

A test case ending incomplete can pass its negative test; it cannot substitute for successful
live operation.

If an external prerequisite genuinely prevents completion, keep the goal incomplete, state
the exact blocker and evidence, preserve safe resumable state, and finish every independent
part still possible. Do not invent results or endlessly retry an unchanged external failure.

Finish with a plain-language explanation and diagram of the actual workflow, the important
simplifications, what was tested, links to the real PRs, remaining limitations, and the exact
shortest way I can start a full-send task from T3.

Throughout, be willing to say that an abstraction, skill, rule, review stage or earlier
implementation should be removed. The objective is a dependable PR creator that is easy
to understand and maintain—not the largest agent system.
