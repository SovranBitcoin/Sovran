# Lens: state machines & async state integrity

Scope: the Colada `PaymentMachine` (`wallet/src/machine/` — `transitions.ts`,
`resolveNext.ts`, `flows/`, `effects.ts`) and its screen-action seam
(`wallet/src/react/usePaymentMachine.ts`), plus ad-hoc async state in screens
and stores that *should* be machines. Authority:
`wallet/docs/STATE_MACHINE.md` — read it first; §11 lists known gaps (never
re-report those as new findings).

## PaymentMachine review

- **Doc-code divergence is itself a regression** (the doc's prime rule).
  Diff `transitions.ts`/`flows/` against the documented step orderings and
  invariants; any silent divergence is a P0 finding.
- Unreachable/illegal transitions: states with no exit on failure paths,
  events accepted in states where their effects are nonsensical, `error`
  reached where the design philosophy says a recovery step (round-up/down,
  `chooseProofs`) should intervene.
- Effects (`effects.ts`) racing the machine: fire-and-forget operations whose
  completion sends an event the machine may no longer be in a state to
  receive. What happens to a late `melt` result after the user dismissed?
- Dismissal integration: do all dismissal paths (button, gesture — see
  dismiss-parity lens) reach the machine's reset? A machine left mid-flight
  across a re-entry is the "dead Next" class.
- Context resolution (`contextResolution.ts`, `selectMintContext.ts`):
  stale context reused across flow entries; amount/mint state surviving a
  flow it shouldn't (payment-flow context bugs are a named priority in
  `sovran-payments`).

## Stale async writes (the general class)

- `setState`/store-write after await with no staleness guard: user navigates
  away or retriggers, the old promise lands and clobbers newer state.
  Detect: `await` followed by `set(`/`setState` in flows that can re-enter,
  with no nonce/seq/abort check. The repo's sanctioned shape is the
  `openSeq`-nonce / supersede pattern — look for async UI flows lacking it.
- Effects without `AbortController`/cancelled-flag cleanup that fetch-then-set.
- Double-submit: buttons dispatching async actions without an in-flight
  guard at the *machine/store* level (a disabled prop alone races fast taps).

## Boolean-flag pseudo-machines

- Clusters of `isLoading`/`isOpen`/`isSubmitting`/`hasError` booleans with
  implicit invalid combinations (loading && error && open) — each impossible
  combination that code must defend against is a finding; the fix shape is a
  discriminated-union status field. Detect: 3+ related booleans in one
  store/component + conditionals guarding contradictory combos.
- `isAnimating` guards that swallow user input (cross-check animations lens
  interruptibility).
- Completion logic living only in animation/timeout callbacks — reduced
  motion or a dropped frame skips it, wedging the flag forever.

## Evidence

```bash
rg -n "await .*\n.*set\(" features shared --multiline | head -40
rg -n "openSeq|supersede|nonce|requestId" features shared    # where the guard pattern exists
rg -n "isLoading|isSubmitting|isOpen" features/payments features/send features/receive
node codereview/analyze-structure/index.mjs wallet/src/machine --llm
npx tsx codereview/log-doctor/index.ts errors --latest --context 5
npx tsx codereview/log-doctor/index.ts coco --latest
```

A machine finding must name the exact transition/step and a user-visible
consequence ("swipe-dismiss during melt-execute → timeline shows X forever").
Cite `STATE_MACHINE.md` section numbers where the contract lives.

## Do not flag

- Gaps already documented in STATE_MACHINE.md §11.
- The machine's deliberate avoid-terminal-errors detours (round-up/round-down
  steps) as "complexity".
