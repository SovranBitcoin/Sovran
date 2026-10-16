# Evidence, context and model routing for full send

Research date: 2026-10-16. Controller audit baseline: `f12db054d`;
second history/native-source audit: `db007cc61`.
Implementation observations below describe those pinned audit baselines, not the current checkout.
This is a researched design, not a second implementation-status ledger.
The [harness README](../../harness/README.md) describes implemented behavior; the
[follow-up ledger](../follow-ups/README.md) owns unfinished work.

The owner selected availability fallback: if Claude is out of quota, GPT-only completion
is allowed with fresh reviewers, an additional review using a different GPT model, and
disclosure. This supersedes the earlier product preference for mandatory cross-provider
review. The executable policy and remaining live validation are described in the harness
README and F159.

## What the research supports

There are three separate questions: does the controller enforce its rules; do real agents
solve the intended task; and is the resulting wallet change safe for supported users?
Passing the first does not establish the other two. Keep the state machine, but add
evaluations of actual agent behavior and independently checked outcomes.

| Primary evidence | Finding and limits | Consequence for Sovran (our inference) |
| --- | --- | --- |
| [Anthropic agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), January 2026 | Evaluate final environment state as well as traces, repeat trials, and calibrate model judgments. Engineering guidance, not a wallet study. | An agent saying a send succeeded is not evidence that the intended state transition occurred. Measure false-ready outcomes as well as solved tasks. |
| [Long-running agent harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), November 2025 | Internal web-app work encountered premature completion, lost progress and superficial tests; structured progress and real interaction helped. | Preserve context across restarts; exercise user journeys and inspect their results. Native wallets need their own evidence. |
| [Generator/evaluator harness](https://www.anthropic.com/engineering/harness-design-long-running-apps), March 2026 | Separate evaluators still excused bugs until their behavior and rubrics were examined. More loops can add complexity. | Test reviewers against convincing but wrong implementations. Keep a review stage only when it catches useful failures. |
| [OpenAI harness engineering](https://openai.com/index/harness-engineering/), February 2026 | One internal project used observable app execution, repository knowledge and structural checks. Its cheap-correction assumptions are environment-specific. | Reuse our native tooling, logs and lint rules. Do not import permissive merge practices into a wallet. |
| [SWE-bench patch-correctness study](https://arxiv.org/abs/2503.15223), September 2025 revision | Some patches labelled solved failed broader developer or differential checks. The results concern the studied tools/dataset. | Test the requested fix and preservation of adjacent behavior, not just new happy-path tests. |
| [SWE-bench evaluation audit](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/), February 2026 | Flawed tests and contamination affected an investigated subset. Its 59.4% figure concerns 138 failure-selected tasks, not all software tasks. | Validate the graders too. Different correct solutions should pass; a leaderboard does not select our reviewer. |
| [Infrastructure noise](https://www.anthropic.com/engineering/infrastructure-noise), February 2026 | Resource configuration moved one benchmark's scores by six percentage points. | Pin environments and separate infrastructure failures from model failures before ranking effort settings. |
| [GitHub cloud-agent protections](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations), retrieved October 2026 | Scoped authority, review, scanning and traceability address practical risks, including malicious instructions in read content. | Test safe synthetic secret leaks, dependency risks and prompt injection. Our trusted host is still not an OS sandbox. |
| [Multi-agent failure taxonomy](https://arxiv.org/abs/2503.13657v3), October 2025 | Analysis identifies system-design, coordination and verification failures across studied agent systems. These are not measurements of our exact models. | Clear responsibilities and information continuity matter more than simply adding agents. |
| [LLM-generated database test flakiness](https://arxiv.org/abs/2601.08998), ICSE SEIP 2026 | In four database systems, GPT-4o and Mistral sometimes inherited flaky assumptions from supplied tests; unordered results were a major cause. Different models and domain from our wallet. | Review example tests before giving them to workers. Existing tests are evidence, not unquestionable templates. |
| [Google's patch-evaluation study](https://research.google/pubs/towards-a-human-in-the-loop-framework-for-reliable-patch-evaluation-using-an-llm-as-a-judge/), AI-SQE 2026 | A shared rubric improved agreement; the proposed judge used expert-refined rubrics, evaluated on 48 bugs and 115 patches. | Define expected behavior before implementation. This does not validate unattended self-written rubrics. |
| [Google mutation testing](https://research.google/pubs/state-of-mutation-testing-at-google/), 2018 | Change-focused fault insertion made test-strength feedback more practical than exhaustive mutation. | Try a small, relevant deliberate fault to establish that an important regression test can detect it. |
| [Meta test reliability](https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/), 2020 | Tracks reliability using execution history and separates code, environment and nondeterminism; does not promise perfectly reliable E2E tests. | Preserve all attempts and their conditions. Passing after a retry cannot explain the earlier failure. |
| [SlopCodeBench](https://arxiv.org/html/2603.24755v1), March 2026 preprint | Python implementations across evolving requirements accumulated duplication and complexity in the studied agents. Hidden tests and changing specifications differ from our repair loop. | Review the cumulative diff and maintenance cost after repairs, not only the latest fix. This does not prove every extra repair is harmful. |

These are evidence for design choices, not proof of our proposed design. No source found
establishes that Opus is always the best reviewer, Fable the best adversary, or mixed
providers statistically independent. Those remain local evaluation questions.

The second research pass also searched Google Scholar and Reddit. Scholar's search page
was inaccessible; primary papers were read through arXiv, author copies and publisher
pages. [This Reddit discussion](https://www.reddit.com/r/ChatGPTCoding/comments/1wldasi/when_a_test_fails_coding_agents_fix_the_test_the/)
describes agents weakening assertions to get green results. It is a practitioner anecdote,
with tool promotion in the discussion, not evidence of how often that happens.
It led to [LGTM](https://github.com/stardeckai/lgtm), a Jev-powered advisory test reviewer.
Its checks for mocks replacing the behavior under test, weak assertions and regressions
that do not distinguish old behavior are useful precedents to evaluate in our existing
JevLint pack. Its model verdict is not execution proof, and no new package was installed.

[Rein's build/test workflow](https://rein-harness.github.io/features/build-and-test/)
documents bounded CI repair, failed-run deduplication, source-aware test history and
mutation checks. These are useful precedents to reuse conceptually. Its optional flake
quarantine can reclassify known failures; that policy is not suitable to copy into our
required evidence gates. Only its documentation was inspected, not runtime enforcement.

## Findings at the pinned audit baselines

The existing controller has meaningful tests for stale source, duplicate command ownership,
process cleanup, dependency authority, immutable context, upgrade-report gaps, ambiguous PR
creation and stale CI after repair. Preserve them. Three additional problems were verified at those baselines:

1. Accepted research is stored in assessments, but its summary, observations and reuse
   discoveries are omitted from subsequent worker briefs. A public-controller probe created
   a temporary repo, submitted a unique research fact, sealed intake and inspected the
   implementation packet: the fact was absent. Findings can be carried, but they are not a
   substitute for the research result. Context is also fixed before this research stage;
   there is no public operation to incorporate its discoveries before sealing. See F160.
2. The same probe submitted a nonexistent `findings[].evidence` path. Research was accepted
   and moved to intake. Observation paths are checked; finding paths are not. This is an
   evidence-validation defect, not proof that any valid path was actually read. See F161.
3. Reference URLs assume every repository is under `cashubtc`. The configured Macadamia and
   Minibits URLs returned 404. Verified upstreams are
   [zeugmaster/macadamia](https://github.com/zeugmaster/macadamia) and
   [minibits-cash/minibits_wallet](https://github.com/minibits-cash/minibits_wallet). See F162.

Other baseline limitations were design gaps: model targets contained no effort or fallback attempts;
ordinary green commands need not establish test discovery or meaningful coverage; docs,
follow-ups, reuse and many layout requirements are instructions rather than individually
accounted obligations. The native/performance block in F156 remains necessary. A list of
project names is not evidence that the relevant upstream behavior was inspected.

## Model and effort policy

Use exact model IDs and explicit effort. OpenAI documents Sol for complex coding at lower
cost than Astra, and recommends comparing candidates on the actual workload. This supports
a starting preference, not a Sovran ranking. [Sol specification](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[model selection](https://developers.openai.com/api/docs/guides/model-selection).

Opus 5.5's documented default is medium; Fable 5.1's is high. Both support low, medium,
high, xhigh and max. Effort levels are not equivalent compute budgets across models.
Anthropic recommends an effort sweep rather than carrying settings between versions.
[Claude effort guidance](https://platform.claude.com/docs/en/build-with-claude/effort).

The following is the proposed initial policy. High effort for consequential wallet judgments
is a conservative choice to evaluate, not a measured optimum. Keep these preferences in
one versioned policy owned by the harness, resolved into the sealed task; do not scatter
them across skills. This table is its design until executable policy exists in F159.
Canonical IDs are `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra`, `claude-opus-5-5`
and `claude-fable-5-1`. The [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
and [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) specifications support
trying bounded collection and demanding analysis respectively; local results decide promotion.

| Work | Preferred model and effort | Availability fallback | Reason and boundary |
| --- | --- | --- | --- |
| Bounded source, blame and documentation collection | GPT-6 Luna, medium | GPT-6.1 Sol, medium; then Opus 5.5, medium | Checkable extraction with exact source pointers; no final safety judgment. |
| Intake synthesis and change/test design | Opus 5.5, high | GPT-6.1 Sol, high | Integrate history, constraints and acceptance criteria. Hard unresolved questions can escalate to Astra high. |
| Implementation and repair | GPT-6.1 Sol, high | Opus 5.5, high; then Astra high | General coding fit. Exactly one source writer; preserve partial work and failed evidence. |
| Independent requirements, history and reuse review | Opus 5.5, high | Fresh GPT-6.1 Sol, high | If completion becomes GPT-only, add a fresh Astra high review, distinct from the normal adversarial/audit slots. |
| Adversarial payment, state and concurrency review | Fable 5.1, high for complex/high-risk work; Opus high for routine work | Astra high; then another permitted independent candidate | Fable is a user-preferred hypothesis for hard counterexamples, not a proven review specialist. |
| Test/log/media interpretation | Independent Sol high or Opus high | Other eligible independent candidate | Models explain actual evidence; runners establish executions, artifacts and platform identity. |
| Docs, follow-ups and file ownership | Implementation worker; its independent reviewer checks the result | Follow that role's fallback policy | These belong to the feature's completion criteria, not a forgotten final cleanup agent. |
| Final qualitative audit | Fresh Opus 5.5, high | Fresh Sol high, with GPT-only extra review if applicable | The deterministic controller still decides whether all required receipts and dispositions exist. |

Use `xhigh` only for a named difficult unresolved question or measured improvement. Reserve
`max` for exceptional cases where its additional time/cost helps. An outage does not justify
silently lowering effort. Anthropic's own coding subset puts Opus medium and Fable high
within run-to-run noise; that subset is explicitly not the public leaderboard. More
expensive does not automatically mean better. [Measurements and caveats](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence),
[Fable positioning](https://platform.claude.com/docs/en/models/fable-5-1/overview).

The live T3 catalog exposes `reasoningEffort` for Codex and `effort` for Claude. Its defaults
can differ from public API defaults: Sol was low in T3 while its API default is medium;
Fable was medium in T3 while its API default is high. Set the option explicitly. Do not
equate host options `ultra`, `ultracode` or `ultrathink` with portable API effort levels;
`ultracode` also introduces orchestration behavior. Validate supported options from the
live catalog, record the requested option, and record actual application only when the
runtime attests it. A worker repeating the requested model/effort is not attestation.

### Fallback preserves the work contract

Separate availability from correctness. A quota/capacity failure can select the next
preauthorized candidate. A failing test, blocking review, refusal or unknown error cannot
be relabelled quota to find a more agreeable model. HTTP status alone is insufficient:
quota/spend limits and transient rate limits have different recovery behavior.
[OpenAI errors](https://developers.openai.com/api/docs/guides/error-codes),
[Claude errors](https://platform.claude.com/docs/en/api/errors).

The sealed policy should contain candidate order, exact model/effort, allowed availability
failures, retry limits, deadline and review-independence rules. Each dispatch has a durable
attempt ID and records its task, role, source, context hash, actual child identity and
failure evidence. Never change the sealed policy to explain a substitution after it occurs.

On availability failure, reconcile the original child and its nested/tool work first.
Unknown dispatch, a lost response, or a timeout with a live writer does not permit a second
writer. Preserve partial edits and logs; a replacement gets their provenance and a fresh
packet. Advancing the attempt must reject late results from its predecessor, survive
restart, keep the original budgets, and dispatch only once under concurrent controllers.

The owner's GPT-only policy means more than using a different account. A successful Claude
research/intake step, or a failed/partial Claude review, does not supply independent review.
The extra GPT review is required whenever the final candidate's accepted review evidence
lacks an eligible non-GPT independent reviewer. Require fresh
reviewers and an **additional** review by a different GPT model from the author; if Sol
authored, use Astra for that extra slot. It cannot also satisfy an existing adversary or
audit slot. If Astra authored, choose an eligible different model, rather than reusing
Astra under another session ID. Disclose requested versus used models and lost provider
diversity in the completion record. Track every model that wrote source during the task, including replacement workers; the
additional reviewer must be outside that author set. This is intended to reduce correlated
mistakes; whether it helps remains to be measured, and different models do not prove
independent errors. If no eligible second model is available, finish incomplete. All original
tests, native evidence and upgrade requirements still apply.

Older tasks must retain their originally sealed authority. Migrate stored shapes so they
remain readable; do not silently add fallback permission to an existing sealed task.

## Practical theory of mind: account for what each worker can know

We cannot inspect a model's internal beliefs or guarantee understanding. We can record
what information was supplied, what it checked, what remains uncertain, and which decision
it may make. Research on perturbed theory-of-mind tasks found fragile performance in the
models tested; it does not establish how our current models will perform as coding agents.
[Study](https://arxiv.org/abs/2602.22072).

Use one small, durable handoff record, not a separate simulation of agents' minds:

`requirement → owner/invariant → history and upstream evidence → decision → verification → unknowns`

Give every substantive fact a source/revision and a status: observed, inferred, disputed,
unknown or superseded. Keep the original instruction/authority snapshot immutable. New
observations may be appended as data; they cannot authorize new scope, dependencies or
publication. Link complete evidence rather than stuffing every repository into every
context. This is consistent with the finite-context and just-in-time retrieval approach
in [Anthropic's context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

| Stage | Must have before it decides | Must pass on |
| --- | --- | --- |
| Research/intake | User outcome, current owners, relevant skills/docs, installed library versions, targeted history and applicable peers | Sourced facts, unknowns, preservation properties, test plan and applicability decisions. Allow the draft to incorporate these before seal. |
| Implementation | Approved decisions, research results, pre-edit rationale, original constraints and prior failed evidence | Source diff, preserved/changed invariants, regression evidence, docs/follow-up dispositions, partial effects. |
| Independent review | Original requirements, base/candidate, historical evidence and raw outputs | Independent findings with reproducible triggers. Initially withhold the author's persuasive summary and earlier review verdicts; later reconcile against their evidence. |
| Adversary | State/operation boundaries, allowed outcomes, relevant protocol/version differences, actual logs | Concrete counterexamples, missed states, falsifiable test cases; not a vote on another review. |
| Repair | Current candidate, unresolved finding IDs, reproductions and old logs marked historical | Disposition for each finding: fixed with evidence, rejected with counterevidence, or out-of-scope with ledger ID. Old failed receipts inform work but never count as fresh passes. |
| Audit/publish | Current-source receipts, all dispositions, selected/skipped obligations, model attempts and review diversity | Complete evidence or an explicit gap; honest PR scope and follow-ups. |

Unknowns must survive compaction, fallback and repairs. Contradictory docs must remain a
visible conflict until source/history resolves them. A fresh reviewer should be able to
identify the acceptance criteria and important invariant without access to the parent's
conversation. Ask for short conclusions and evidence, not private chain-of-thought.

## Git history before editing

The guarantee should be: **every changed behavior has a documented rationale investigation
and a preservation decision, or an explicit unresolved gap**. “100% know why” is impossible
when intent was never recorded, history was squashed, or the relevant discussion is missing.
Do not fill those gaps with confident stories.

Reuse the existing [audit-commit history procedure](../../.agents/skills/audit-commit/SKILL.md)
before editing, with the post-commit audit checking that the resulting change honored it:

1. Pin the base revision and identify the behavior/callers to change. Collect targeted
   `git blame -w -M -C -L start,end <base> -- <path>` evidence, retaining attribution caveats.
2. Read the relevant introducing/fixing diff, its parent behavior, regression tests and
   referenced ADR/issue/PR. A commit message is a claim, not proof. Follow renames and
   earlier guards; use `git log -S` or `-G` when the crucial code was removed or replaced.
3. Write the reason in plain language: “this guard prevents X when Y happens.” Label whether
   the reason is explicit, supported inference or unknown. State what will preserve X.
4. Establish a behavioral regression or other appropriate evidence before removing or
   loosening the guard. A harmless formatting change needs proportionate investigation;
   new code needs ownership/reuse rationale, not invented blame.
5. Recheck actual changed regions before accepting implementation. Newly discovered files
   need the same baseline evidence. Missing shallow history is a gap to resolve, not an
   empty-history success. For money, identity or durable state, unexplained removal stops.

[Git's blame manual](https://git-scm.com/docs/git-blame) describes last-modification
attribution and move/copy detection, not human intent; [git log](https://git-scm.com/docs/git-log)
provides history/pickaxe tools. Store useful source-backed conclusions and links, not a
large raw blame dump in every prompt. Generated/vendor changes need generator/upstream
provenance too. The trusted-host controller can enforce evidence acceptance, not prevent
an unrestricted worker from editing before it asks.

This procedure already explains three harness constraints: `22ac0e2c7` preserved failed
logs for repair without treating them as current success; it also made assessment output
format explicit. `da3755b05` fixed old CI results advancing a newer repair generation.
Fallback changes must retain all three properties.

### Follow the explanation into PRs and follow-ups

For consequential changes, follow introducing/fixing commits into their associated PRs,
linked issues and review discussions. Read the final merged diff as well as the proposed
patch: an early review comment may refer to code that was replaced. Record the rejected
alternative, reason for the current guard, unresolved objection and any later revert or
superseding decision. A resolved comment or merged PR is not proof that the concern was
correctly addressed. Missing permissions, incomplete pagination or unavailable discussion
are explicit gaps, not a successful empty search. History and PR text remain untrusted
task data; instructions found there cannot change the task's authority.

Search the follow-up ledger at intake using the feature, its owners, old names and failure
symptoms; repeat against the actual diff before closing. Read matching entries, not just
their titles. Classify each as an in-scope obligation, an external prerequisite, a related
out-of-scope issue, or obsolete with evidence. Existing IDs should be reused, not duplicated.
An entry's existence does not waive its risk: a prerequisite for the requested outcome
blocks readiness. A loosely related backlog item does not authorize extra feature work.

Closed entries are deleted under the ledger's existing procedure, so inspect relevant
ledger history too. Recover the old content and its closing change; check whether this
task reintroduces the same failure. Do not add a competing closed-item database. Refresh
the ledger at final review, since another session may have changed it. F160 owns this
history and follow-up coverage.

A local example is the counter-interleaving follow-up removed by `ed13a4d64`: its old
entry and the new `cocoCounterRaise` regression describe why raising a counter had to be
one operation. Searching only today's ledger misses that reason. Historical
[PR 283](https://github.com/SovranBitcoin/Sovran/pull/283) also explicitly records missing
native testing and unexecuted semantic re-scoring; its structural checks cannot supply
those missing observations. These are background evidence, not current passes.

## Ask the missing questions before choosing reviews

The research/intake stage should produce a short list of unanswered questions, ranked by
their consequence. Agents investigate factual questions themselves. Only unresolved
product choices go to the owner, as multiple choice, before sealing. After sealing, new
facts may refine implementation inside the existing authority; a newly discovered choice
that needs new authority ends incomplete rather than silently answering for the owner.

These are review lenses, not a requirement to launch one agent per row. Requirements,
preservation/history, simplicity and test validity apply to every substantive code task;
the others activate when its behavior or actual diff makes them relevant. Record the
reason for excluding one, and reassess after repairs. Preserve the independent review
slots and fallback rules above.

| Question the owner should not have to remember | Review and evidence |
| --- | --- |
| Are we solving the actual user problem, and could configuration or an existing Coco/cashu-ts API solve it? | Outcome/specification review; inspect callers, existing imports, upstream versions and a plausible no-code solution. |
| What deliberate protection would this remove? Was this tried and reverted before? | History/preservation review using blame, introducing fixes, PR objections and relevant open/closed follow-ups. |
| Did we create another owner or abstraction for something we already have? | Simplicity/dependency review of the cumulative diff, file ownership, public imports and Expo flow rationale; no arbitrary line-deletion target. |
| Could every test pass while the user still gets the wrong result? | Test-validity review: independent expected outcome, actual execution, negative controls, meaningful side effects and preserved adjacent behavior. |
| What if the app dies, changes account, loses a reply or receives it twice? | Failure/recovery review across operation boundaries; account isolation, cancellation, duplicate delivery, reconciliation and partial completion. |
| What can an older or interrupted install contain? Could going back to an older binary make it worse? | Persistence/compatibility review with historical fixtures and migration interruption evidence; never assume rollback reverses a migration. |
| What can hostile content or a dependency cause us to expose or execute? | Security/privacy review of keys, bearer tokens, logs, permissions, external inputs and supply-chain changes; synthetic secrets in tests. |
| Does this remain usable on a slow phone, with large text, or without the network? | Applicable native, accessibility, offline and measured performance checks; actual build/platform and device limitations remain visible. |
| Can we diagnose a failure without leaking data, and does the documentation tell the truth? | Observability/docs review of error paths, useful redacted logs, public claims, owning docs and follow-up dispositions. |
| Does the exact candidate still work with the current base and required CI? | Final integration review, source-bound receipts, base drift checks and complete required checks; owner still merges. |

## Prove that the tests deserve trust

A test's **expected outcome** must come from the approved requirement, protocol or a
separately verified invariant. Computing it with the same helper being tested can repeat
the same mistake. A test passing consistently establishes repeatability, not correctness.

For a substantive bug fix, demonstrate the regression failing on the relevant old behavior
and passing on the candidate, in isolated disposable checkouts. Inspect the failure: a
missing new import, compile error or setup timeout is not reproduction of the bug. For a
new feature or an incompatible test API, use a valid counterexample or targeted deliberate
fault instead. Examples include accepting the wrong account, dropping the final state
write, or allowing a duplicate operation. Verify that the fault is reached and represents
forbidden behavior; equivalent changes and infrastructure failures do not count as caught
bugs. Keep this proportionate to risk, not a mutation-per-line requirement.

Also verify the intended journey. In [Slack's agentic-testing experiment](https://slack.engineering/agentic-testing-where-agents-fit-in-the-e2e-testing-stack/),
agents often reached the goal through different UI paths. The study covered two browser
flows with different models across approaches, not native-wallet bug detection. Our
inference: exploration may discover a workaround, but a test of a broken Expo sheet or
accessibility control must exercise that specified path. Reaching the same final state
through another route does not satisfy it.

Independently review changes to tests, fixtures, mocks, filters, budgets, skips, snapshots
and runner scripts. Legitimate corrections are allowed when the original requirement or
history establishes why the old expectation was wrong. The author cannot redefine the
expected result solely because its implementation produced a different one. Keep important
baseline/held-out checks outside the ordinary writer's editable contract, subject to the
trusted-host limitation already stated.

For native E2E evidence, retain the scenario purpose, starting app and mint state, exact
build/source, platform, runner revision, commands, all attempt outcomes and raw artifacts.
Check both the visible journey and the resulting wallet state. A success toast or a
logged function call alone does not prove a payment's intended outcome. Verify that error
injection actually changes the real path, that the test installed the intended build and
that fixture resets isolate both the wallet and its mint. Use disposable, unfunded state.

Test reliability needs its own experiment: first hold source and environment fixed, then
vary justified stress conditions such as test order, parallelism, cold/warm start and
delayed replies. Record failures as product, test, infrastructure or unknown with evidence;
an intermittent product race is still a product defect. Choose repetition counts and
conditions before looking at the results. Several green runs do not prove absence of
flakiness. Keep earlier failures visible even after a later pass, and monitor test health
across tasks. A known-flake label alone never excuses a task-specific missing check.

Wait for observable state with bounded deadlines. Retrying a read is different from
issuing a payment, publish or delete again. A fresh whole-story diagnostic run is allowed
only after reconciling the old run and resetting isolated disposable state; never retry an
uncertain side effect to make the UI turn green. Required GitHub checks cannot be bypassed
by an agent's unrelated-failure classification. Whether an independently established,
pre-existing unrelated flake may be disclosed without blocking is an intake policy choice;
absent sealed permission, keep required evidence fail-closed.

### The historical action-once contradiction

[ADR 0033](../../app/docs/adr/0033-an-end-to-end-test-is-one-user-story-run-fast.md)
requires issuing each action once. At the native-source audit baseline, the
[story runner](../../app/e2e/stories/play.ts) could issue a second tap when touch logs/pixel
change have not been observed. Blame and the introducing diff (`9654087556`, refined by
`60a8856342`) show an intentional workaround for taps lost while sheets open; its unit
test explicitly expects two taps. That explains its purpose, but absent feedback does
not establish that a side effect never began. No operation-effect classification guards
that generic retap path. This is a source-read conflict, not an observed duplicate payment.

The retap was subsequently removed; F149 preserves the unresolved driver failures that
motivated it. F156 must reject ambiguous repeated-action evidence and
retain the native certification block until the runner's action semantics and source/build
binding are validated. Android parity was absent at that baseline; current producer limits
and actual platform evidence belong in F156.
The older scenario runtime remains coverage where no replacement story exists; do not
combine their green summaries into a claim of both-platform verification.

## Loop on unresolved evidence, not on votes

Each repair round should name the open finding, the hypothesis being tested, the smallest
change or experiment, and the evidence that would disprove it. Preserve finding identity
across rounds; a new reviewer cannot erase an unresolved objection by returning "pass".
A disagreement calls for a reproduction or explicit counterevidence, not a majority vote.
Fresh reviewers first form their own view, then receive earlier objections for reconciliation.

After a repair, rerun the affected checks and the required regression set, reconsider risk
applicability, and review the cumulative diff for complexity and revived historical bugs.
Prior passing evidence is historical when source changes; the final gates still need
current-source receipts. Record whether the round closed a risk, disproved a hypothesis,
or produced no new evidence. A model's confidence score is not a substitute for these.

Repeated failure with no new evidence, oscillating fixes, or growing scaffolding triggers
a diagnosis/architecture review within the original scope and preauthorized model budget.
Try a different hypothesis or simplify the candidate; do not repeat the same prompt with
more effort indefinitely. Preserve unsuccessful candidates and reasons as history. Any
return to an earlier candidate needs fresh checks and current-source review.

The state machine may keep repairing while unresolved in-scope findings have a useful next
experiment and the sealed budget permits it. Readiness requires all applicable obligations,
dispositions and independent reviews on the exact candidate. Exhausted budget, unavailable
required evidence, unresolved critical objections or missing authority end incomplete,
with resumable evidence and follow-ups. They do not produce a ready PR. This is the proposed
confidence loop; evaluate the executable bounded repair loop against those obligations.

## Docs, tests, layout and related projects are obligations

At intake, assign each applicable concern a required artifact/check and owner, or a
reasoned not-applicable decision. Re-evaluate applicability against the actual diff.
Discovered risk cannot silently disappear because the initial scope description missed it.

- **Unit/integration:** reproduce the defect, check the new outcome, and preserve adjacent
  behavior. Record discovered/executed/skipped tests and runner/config identity. A script
  returning zero before testing is not success. Legitimate test additions are allowed;
  independently review deletions, filtering, mocks and weakened assertions. Keep a protected
  baseline or held-out grader outside the candidate's ordinary edit scope; trusted host
  access means this remains an audited boundary, not isolation from hostile shell use.
- **E2E/performance:** scenario IDs, platforms, installed binary/source, run/session IDs,
  logs, resulting state and media must agree. Examine meaningful frames and stderr, not
  merely the last green summary. Measure comparable device/build conditions. F156 still
  blocks certification until this connection is implemented and validated.
- **Docs:** identify the owning document and impacted public claims before implementation;
  verify changed behavior against it afterward. “No docs change” can be correct when
  supported. Avoid new documents that repeat code inventories.
- **Follow-ups:** each deferred discovery has a disposition and valid ledger ID; run the
  existing ledger checker. Do not defer an in-scope acceptance failure merely to get green.
- **Layout/reuse:** route companion conventions and relevant ADRs, then run existing
  structural checks. Preserve `app → wallet → nostr` ownership and the existing reason
  for Expo `-flow` wrappers. Search owners and public imports before adding a helper or
  npm package. Reward simpler callers and preserved behavior, not raw deletion counts.
- **Upstreams:** NUTs supplies protocol requirements; installed Coco/cashu-ts supplies
  actual API/state ownership; CDK/Nutshell provides mint interoperability evidence;
  cashu.me, Macadamia, Minibits and cashubtc/wallet provide relevant peer behavior. Choose
  the applicable projects at research, implementation and review, with an explicit reason
  for selection or omission. Compare pinned versions to installed versions. Peer behavior
  is evidence to weigh, not permission to override Sovran contracts or copy internals.

Use a vetted project-ID-to-origin catalog and deterministic cache
`/tmp/sovran-harness/references/<owner>/<repo>/<commit>`. Retain license/provenance and
exact relevant sections. Reject wrong origin, dirty/partial cache and commit mismatch.
Do not redirect an old sealed snapshot when updating the catalog. F162 records the remaining
validation of corrected origins and actual selected upstream snapshots.

## Acceptance families

These are acceptance families for F159–F163, not a current test inventory or a claim that
local passing tests establish real-agent performance.
Prefer observable failures over assertions that prompts contain particular words.

| Priority | Test scenario | Required result |
| --- | --- | --- |
| P0 | Research-only invariant and unresolved question survive restart, sealing and replacement worker | Implementation sees their sources/status; review can independently verify them. |
| P0 | Finding cites absent/traversing/stale evidence; deferred finding has no real ledger disposition | Reject unsupported evidence or keep incomplete, consistently with observation validation. |
| P0 | Quota before dispatch, after acceptance or after partial edits; original child still live; lost response | Only definitive reconciled availability failure can dispatch one replacement. No duplicate writer. |
| P0 | Concurrent fallbacks, restart between intent and effect, late old result, exhausted deadline | Preserve one current attempt, source/context identity and original budgets. |
| P0 | Opus quota fallback after Sol authored | Fresh GPT reviewers plus an additional different-model review; no slot double-counting; disclosed mode. |
| P0 | Negative review, test failure or malformed error presented as quota | Do not shop for a passing verdict. Repair or stop under the original rules. |
| P0 | Package script exits zero, test filter finds nothing, assertions are skipped, report is partial/fabricated | Missing required observations cannot certify completion. Test changes have an explicit reviewed delta. |
| P0 | Regression is red only because a new import is absent; a deliberate fault fails compilation; valid alternative is rejected | Do not claim behavioral discrimination; require meaningful valid/broken controls. |
| P0 | First action was accepted but telemetry is delayed; a repeated tap produces eventual success | Exactly one side-effecting action; ambiguous repeated-action evidence cannot certify the journey. |
| P0 | Failed attempt is replaced by a later green run; scenario is listed but never executes | Preserve all attempts and require actual execution; unresolved failure remains visible. |
| P1 | Removal of an odd-looking duplicate-send guard whose reason exists only in an old fixing commit | Recover rationale and preserve its behavior, including after rename/formatting. |
| P1 | Reason exists only in an old PR objection or a deleted follow-up; PR retrieval is partial | Carry the historical constraint or explicit missing evidence; no empty-search success. |
| P1 | Agent reaches success via another route while the required sheet/control stays broken | Journey requirement remains failed even if final state is correct. |
| P1 | Repairs oscillate, a fresh reviewer ignores an old objection, or a false finding proposes unnecessary work | Preserve finding identity, verify counterevidence and choose a new experiment or incomplete; do not count votes. |
| P1 | One of several requirements is a stub; plausible implementation summary says all work is complete | Independent outcome checks and reviewer identify the missing behavior. |
| P1 | Failure visible only in stderr, a late frame or final database state | Reviewer identifies the actual counterexample, not just copies artifact hashes. |
| P1 | Upstream example uses a newer/incompatible API; wrong repo origin; partial cache | Explicit version mismatch or retrieval gap, never invented compatibility. |
| P1 | Stale docs, missing follow-up, duplicate helper, forbidden import or wrong Expo ownership | Relevant obligation catches it; a valid no-doc-change task also passes. |
| P1 | Synthetic secret in logs/PR text; malicious instructions inside repository/reference data | No unauthorized publication, authority change or exposure; report actual trusted-host limits. |
| P1 | Wrong installed binary/platform/session, successful UI but failed operation, incomparable performance run | Stay incomplete even when generic unit commands are green. |
| P1 | Live GitHub response loss, base drift, required-check change and publication restart | Reconcile exact candidate/PR without duplicate creation, merging or stale readiness. |

Add event-sequence tests around the XState/SQLite transitions, particularly crash boundaries;
reuse the current tooling before adding another state-machine testing dependency. Keep
the native and live publication work attached to F156/F157 rather than declaring it done
through more fake-service tests.

## How to learn which models are actually better here

Create a small held-out task suite from real Sovran mistakes and clean cases (F163). Start
with roughly 20 varied cases as a pilot, not a statistically conclusive safety certificate.
Include fixes that must change code, cases where preserving code is correct, old-state
upgrade cases, reuse/layout tasks, context loss, and provider/tool failures. Use disposable
unfunded state. Establish a known-valid outcome and independently checked grader first.

Compare the same role at medium/high on identical source, context, tools and runtime;
use high/xhigh only on the hard subset. Repeat trials. Separate success within a repair
budget from success on every repeated trial. Record severe escaped defects, false-ready
rate, correct abstention, false blocks, review precision/recall, history coverage, unsupported
claims, scope/dependency growth, latency and cost per accepted result. Keep review identity
hidden from the grader where feasible. Inspect failed traces and a sample of passing ones.

Keep development cases separate from held-out cases; do not tune prompts on the latter.
For historical evaluation tasks, expose history only through the selected baseline; exclude
later solution commits, linked gold patches and answer-bearing caches from worker-visible
evidence. Keep those with the grader and test for leakage. This restriction applies to
controlled evaluations, not ordinary development history investigations.
Use alternative correct solutions to detect an overly narrow grader. Add new real failures
over time. Fresh benchmarks such as [SWE-bench Live](https://arxiv.org/abs/2505.23419) and
broader tasks such as [SWE-bench Pro](https://arxiv.org/abs/2509.16941) motivate freshness and
integration coverage; their old model scores do not rank today's routing candidates.

Ablate added reviewers and context: does the extra stage catch additional verified defects,
or just repeat a verdict and increase cost? Promotion should follow measured improvements,
not a model launch or self-reported confidence. Expected failure cases must remain visible.

## Original proposed implementation order

1. **Correct reference identity and evidence validation** (F162/F161). Reuse the current
   snapshot/path validation; add reproductions before fixing. Preserve sealed old tasks.
2. **Carry research and require pre-edit rationale** (F160). Extend the existing handoff and
   draft/seal transition; reuse audit-commit and existing docs rather than add more agents.
3. **Add model/effort policy and reconciled attempts** (F159). Replace single targets with
   versioned authorized routes, preserving compatibility and actual reviewer independence.
4. **Enforce applicable evidence obligations** (F160/F161). Reuse repository test, docs,
   follow-up and structure checks; reject green-but-empty evidence.
5. **Run held-out agent and live integration evaluations** (F163/F156/F157). Choose model
   defaults from measured outcomes, then expand unattended use. Owner still merges.

This research supplies rationale and evaluation criteria. The harness README owns implemented
behavior and the follow-up ledger owns remaining work; neither model agreement nor this
design grants publication authority.
