# Semantic review policy

**Draft: automated coverage is not preserved yet.** The twelve rules below are not an equivalent
replacement for the previous policy. A subsequent audit found useful checks missing or narrowed:
input validation and trust, security-sensitive randomness, mock isolation, safe consent/trust
defaults, backup verification, mint trust, structured errors, synchronous profile isolation,
non-retry signed-event mutation, subscription recovery, and UI/test correctness. Some exclusions
also miss unit-only changes, persisted-write changes and status changes affecting re-entry guards.

The 61 explicit rules' text and exceptions survive in contributor guidance, but that is not
automated coverage. Removing the lock also removes its compiled guidance from evaluation. Before
merging this migration, map every old rule to a tested semantic replacement, a verified deterministic
check, or an explicitly justified retirement. The eight development fixtures do not prove parity.

Hunch's GitHub App already reviews this repository. Do not add a second Actions reviewer.
PR policy and contracts come from the immutable base commit; edits here take effect after merge.
The new `review` and choice `abstain` options require Hunch 0.13.0 or this source revision. npm
0.12.0 cannot read them. Deploy the updated App before merging this policy; use the verified
local build for validation until npm is released.

Twelve concerns replace 61 explicit, heavily gated questions plus compiled generic guidance.
Every in-scope source window receives all twelve concerns in one request with the shared contract.
There are no lexical prefilters. Native bridge code is included; upstream BitChatVendor trees,
other declared generated/build/vendor paths and Hunch's built-in exclusions are outside scope.
The retired hunch.lock is removed because this policy intentionally selects no compiled guidance.
All former contributor conventions remain in [contributor-conventions.md](contributor-conventions.md).

[contracts.md](contracts.md) defines domain meanings and allowed cases. Its source links are for
human investigation, not automatic source expansion. Head-source context is bounded at 40 lines;
callers, schemas and distant guards may still be absent. An `insufficient-context` response makes
coverage partial and asks for investigation. Findings are advisory, never a blocking correctness
certificate. Experimental localization remains off; narrow ranges have not been validated on
independent Sovran defects.

## Development evidence

Eight paired synthetic diffs in [fixtures](fixtures) cover plaintext secrets, uncertain payment
outcomes, relay delivery claims and signed-event retries. The final live Jev evaluation on
2026-09-19 returned each of four expected concerns and none on their four safe counterparts.
All twelve rules were asked on every fixture. [Recorded output and hashes](evaluation-2026-09-19.json)
identify the exact policy and fixtures.

These are tuning data. Earlier iterations over-abstained on unchanged mechanisms and incorrectly
applied payment/amount concerns to relay or status-only changes. Questions now state those
boundaries explicitly. One initial negative fixture renamed a persistent seed key; it was replaced
because that was not a valid known-safe example. There is no independent recall estimate, and
the other eight concerns have no positive/negative coverage yet. Do not interpret the CLI's
1.00 for rules with zero expected cases as evidence of accuracy. Maintain nonblocking severity
and expand labels using reviewed real defects before raising enforcement.

From this repository, using the verified CLI:

```sh
hunch config
hunch eval docs/review/fixtures --reporter json
hunch check --base origin/main
```

The App caps runs at 240 seconds even though local whole-repository checks allow longer.
Review every coverage notice; repeated incomplete results require better context or rule wording,
not relabeling unknown outcomes as safe.
