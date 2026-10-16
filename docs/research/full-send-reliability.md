# Evidence, context and model routing for full send

Research date: 2026-10-16. Source audit baseline: `f12db054d`.
This is a researched design, not a claim that the proposed gates already run.
The [harness README](../../harness/README.md) describes implemented behavior; the
[follow-up ledger](../follow-ups/README.md) owns unfinished work.

The owner selected availability fallback: if Claude is out of quota, GPT-only completion
is allowed with fresh reviewers, an additional review using a different GPT model, and
disclosure. This supersedes the earlier product preference for mandatory cross-provider
review. The current controller still enforces the earlier rule until F159 is implemented.

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

These are evidence for design choices, not proof of our proposed design. No source found
establishes that Opus is always the best reviewer, Fable the best adversary, or mixed
providers statistically independent. Those remain local evaluation questions.

## What the current implementation actually establishes

The existing controller has meaningful tests for stale source, duplicate command ownership,
process cleanup, dependency authority, immutable context, upgrade-report gaps, ambiguous PR
creation and stale CI after repair. Preserve them. Three additional problems were verified:

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

Other limitations are design gaps: model targets contain no effort or fallback attempts;
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
Do not redirect an old sealed snapshot when updating the catalog. The current hardcoded
catalog must be corrected before claiming it can load all requested projects (F162).

## Tests missing from the first version

These are proposed acceptance families for F159–F163, not a list of tests already passing.
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
| P1 | Removal of an odd-looking duplicate-send guard whose reason exists only in an old fixing commit | Recover rationale and preserve its behavior, including after rename/formatting. |
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

## Implementation sequence

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

This research changes no controller code, wallet state or publication authority. It defines
the next implementation and records its gaps; an approved policy is not yet an enforced gate.
