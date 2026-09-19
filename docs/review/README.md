# Semantic review policy

**Draft: migration parity is not verified yet.** The twelve explicit concerns alone are not an
equivalent replacement for the previous policy. A subsequent audit found useful checks missing or narrowed:
input validation and trust, security-sensitive randomness, mock isolation, safe consent/trust
defaults, backup verification, mint trust, structured errors, synchronous profile isolation,
non-retry signed-event mutation, subscription recovery, and UI/test correctness. Some exclusions
also miss unit-only changes, persisted-write changes and status changes affecting re-entry guards.

The 61 previous explicit rules' text and exceptions survive in contributor guidance. Compilation
is now enabled for that document, the codebase-design and expo-router skills, and root `AGENTS.md`.
Their generated questions are committed in `hunch.lock`; inspect its `notChecked` entries for
guidance the compiler could not turn into per-hunk checks. Compilation is not proof of equivalent
coverage. Before merging this migration, map every old rule to a tested semantic replacement, a
verified deterministic check, or an explicitly justified retirement. The eight development
fixtures do not prove parity.

Hunch's GitHub App already reviews this repository. Do not add a second Actions reviewer.
PR policy and contracts come from the immutable base commit; edits here take effect after merge.
This policy requires Hunch 0.13.1: it fixes compiled path matching and allows the larger
per-hunk question budget. Use the verified local build until that version is published, and
update the GitHub App before merging this policy. npm 0.13.0 does not support the new budget.

Every in-scope source window receives all twelve explicit concerns with the shared contract.
Applicable compiled questions are asked in a separate request; their path scopes are recorded in
`hunch.lock`. The reviewed lock consolidates 111 compiler-generated questions into 72, grouping
facets of the same source concern while preserving their exceptions. Inferred lexical gates were
removed. Review also scoped Expo route-file checks to `app/app`, left literal testID presence
to deterministic tooling, and resolved the legacy sent/delivered wording in favor of the shared
contract: local sent state after the first relay OK is allowed. The largest effective policy is 72 questions for one file, within the configured limit
of 128. Recompilation with `--force` can replace these reviewed edits; repeat the scope and budget
audit before committing it. [Recorded scope and request-size simulation](compilation-2026-09-19.json) uses synthetic answers
and establishes mechanical coverage only, not semantic accuracy.

Native bridge code is included; upstream BitChatVendor trees, other declared
generated/build/vendor paths and Hunch's built-in exclusions are outside scope. All former
contributor conventions remain in [contributor-conventions.md](contributor-conventions.md).

[contracts.md](contracts.md) defines domain meanings and allowed cases. Its source links are for
human investigation, not automatic source expansion. Head-source context is bounded at 40 lines;
callers, schemas and distant guards may still be absent. An `insufficient-context` response makes
coverage partial and asks for investigation. Findings are advisory, never a blocking correctness
certificate. Experimental localization remains off; narrow ranges have not been validated on
independent Sovran defects.

## Development evidence

Eight paired synthetic diffs in `docs/review/fixtures/` cover plaintext secrets, uncertain payment
outcomes, relay delivery claims and signed-event retries. The final live Jev evaluation on
2026-09-19 returned each of four expected concerns and none on their four safe counterparts.
All twelve explicit rules were asked on every fixture, before compiled guidance was restored.
[Recorded output and hashes](evaluation-2026-09-19.json) identify that historical policy and
fixtures; they do not validate the additional compiled questions.

These are tuning data. Earlier iterations over-abstained on unchanged mechanisms and incorrectly
applied payment/amount concerns to relay or status-only changes. Questions now state those
boundaries explicitly. One initial negative fixture renamed a persistent seed key; it was replaced
because that was not a valid known-safe example. There is no independent recall estimate, and
the other eight concerns have no positive/negative coverage yet. Do not interpret the CLI's
1.00 for rules with zero expected cases as evidence of accuracy. Maintain nonblocking severity
and expand labels using reviewed real defects before raising enforcement.

From this repository, using the verified CLI:

```sh
hunch compile --dry-run
hunch compile --with codex --effort low
hunch config
hunch eval docs/review/fixtures --reporter json
hunch check --base origin/main
```

`hunch compile` previously had nothing to read because `skills` was empty, `agentsMd` was false
and no `docs` were selected. The selected sources above now make plain `hunch compile` work;
commit the reviewed lock whenever these sources change.

`hunch check --base origin/main` reviews branch changes. Use `hunch check --all --code` for all
in-scope files, or add `--dry-run` first to inspect the scope without calling Jev. The 2026-09-19
dry run found 4,460 chunks across 2,401 files. Budgets allow 5,000 hunks and 10,000 requests
so these chunks fit even with separate explicit and compiled question batches.
`app/codereview/analyze-structure/index.mjs` contains a literal NUL byte and is skipped by the
binary-file check; it still needs manual review. An offline engine simulation also found one
window of `app/assets/icons/index.tsx` exceeding the request context budget after questions and
surrounding source were included. Treat that window as incomplete; do not call this full coverage. File counts do not establish model recall.

The App caps runs at 240 seconds even though local whole-repository checks allow longer.
Review every coverage notice; repeated incomplete results require better context or rule wording,
not relabeling unknown outcomes as safe.
