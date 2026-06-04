---
name: Payment machine state-management decision
description: Decision note comparing XState with a formalized internal effect runner for Colada's payment machine
tags:
  [colada, payment-flow, state-machine, effects, xstate, dim-1, dim-2, dim-7]
status: decided
date: 2026-05-31
related:
  - src/machine/createMachine.ts
  - src/machine/transitions.ts
  - src/machine/resolveNext.ts
  - src/machine/flows/send.ts
  - src/machine/flows/receive.ts
---

# Payment Machine State-Management Decision

## Decision

Do not install or adopt XState in the current architecture slice.

Formalize the current custom payment machine first by extracting an internal
effect runner behind the existing `PaymentMachine` interface. Re-evaluate
XState only after Colada has explicit effect descriptors, model tests over
transition/effect pairs, and one flow whose current manual lock/stale-result
logic can be deleted rather than translated.

## Why

XState is a real candidate for this domain, but it does not pass the deletion
test yet.

The current `createMachine.ts` module owns too many concerns at once:

- Mutable runtime state, execution flags, a re-entrant send lock, generation
  based stale-result suppression, pending payment-request confirmation holders,
  and snapshot notification live together near `step`, `flowCtx`, `stepData`,
  `sendLocked`, and `flowGeneration`.
- Confirm-melt and confirm-payment-request bypass the pure `transition()`
  module and manually interleave operations, notifications, rollback/fallback
  routing, handler dispatch, and lock release.
- NFC, send, mint quote, mint review, trust mint, background recipient identity,
  and mint-list enrichment effects each repeat local patterns for
  `handlerExecuting`, `notify()`, `try/catch`, stale-result checks, and
  post-operation `setStep()`.
- Pure transition work already exists in `transitions.ts`, `resolveNext.ts`,
  and the send/receive flow modules. That is a useful base, but it has not yet
  isolated async effects from the machine runtime.

XState v5 can invoke promise actors and discards a promise result when the state
that invoked it exits. That maps well to several Colada stale-result problems.
It also supports typed setup for invoked actor logic. However, adopting it now
would likely wrap the existing branches in statechart configuration while
leaving operation-specific fallback, notification, rollback, NFC, and handler
dispatch logic embedded in actions. That would add a dependency without deleting
the custom machinery that currently makes the module hard to reason about.

## Option A: Formalize The Current Machine

Preferred next step.

Target shape:

- Keep `PaymentMachine` public methods stable: `scan`, `send`, `inspect`,
  `subscribe`, and flow helper methods.
- Keep pure transition resolution in `transition()`, `resolveNext()`, and
  per-flow modules.
- Add an internal effect runner that accepts the current snapshot plus a named
  effect descriptor and returns an explicit result:
  - next step/data
  - context patch
  - notifications to emit
  - handler step to dispatch
  - rollback/fallback result
  - whether the machine remains executing
- Model one lock/cancellation/generation rule in the runner instead of repeating
  it in each operation branch.
- Add invariant tests for send, melt, payment request, mint quote, NFC
  write-back rollback, mint review, and stale async results.

Expected deletion:

- Repeated `handlerExecuting = true/false` and paired `notify()` calls.
- Repeated `isStaleGeneration(...); return` checks at each await boundary.
- Repeated operation `try/catch` scaffolds that all turn into a small set of
  effect result kinds.
- Confirm-melt and confirm-payment-request special cases that currently bypass
  transition routing.

## Option B: XState Behind `PaymentMachine`

Revisit after Option A names the effects.

Potential wins:

- Invoked promise actors naturally model async work that is bound to a state.
- State exit can discard stale promise results without a hand-written generation
  guard in every branch.
- Statecharts can make allowed transitions and funds-at-risk states easier to
  inspect and test.

Current blockers:

- The effect surface is not explicit enough. The hard part is not the state
  label; it is how each state performs wallet I/O, emits notifications, handles
  rollback/fallback, and dispatches UI handlers.
- The current machine has several side channels that need a single policy
  before a statechart can simplify them: `sendLocked`, `flowGeneration`,
  `pendingPaymentRequestConfirms`, `processedRef`, UR decoder state, and NFC
  session cleanup.
- A full migration now would be a large wrapper over the current branch tree,
  not a smaller interface with more implementation behind it.

Adoption criteria:

- A prototype of one funds-at-risk flow deletes the manual lock/stale-result
  logic for that flow.
- The public `PaymentMachine` interface stays stable for `sovran-app`.
- No React, Expo, native module, route, store, or Sovran product state enters
  Colada core.
- Bundle/runtime cost is checked in the React Native app before adoption.
- Tests assert flow invariants instead of mirroring statechart syntax.

## Effect Runner Progress

`createMintQuote` is now the first extracted internal effect runner. It proved
the runner interface on the smallest auto-executed operation: a named effect
returns a typed result, carries transaction-created notifications as data,
maps offline/operation failures into `MINT_QUOTE_FAILED`, and turns stale async
completion into an explicit `stale` result.

`confirmSend` is now the second extracted effect runner. It covers online send,
local-first token creation, local proof fallback after mint failures,
transaction-created notification data, proof-selector fallback, hard
`SEND_FAILED` errors, and stale async results. The machine still owns the public
runtime contract, lock lifecycle, step application, handler dispatch, and
notification emission.

`confirmMelt` is now the first funds-at-risk confirmation branch behind the
runner. The effect returns the updated preview step data, transaction-link
intent, payment-confirmed notification data, transaction-created notification
data, melt-quote lifecycle notification data, stale completion, and typed
failure. The machine still emits `onPaymentProcessing`, routes melt failures
through BIP321 fallback/error handling, applies links, dispatches handlers, and
owns the send lock.

`confirmPaymentRequest` is now the second funds-at-risk confirmation branch
behind the runner. The effect returns success step data, transaction-link
intent, payment-confirmed notification data, transaction-created notification
data, a typed `rolledBack` outcome, stale completion, and typed failure. The
machine still owns the per-call result holders, `onPaymentProcessing`, rolled
back/failure routing, handler dispatch, and lock lifecycle.

Mint review info loading and trust-mint are now behind the runner too.
`runMintReviewInfoEffect()` returns enriched `reviewMint` / `openMint` step data,
stale completion, and typed error step data. `runTrustMintEffect()` returns
trust completion, stale completion, and typed error step data. The machine still
owns execution flags, step application, handler dispatch, and error
notifications.

Mint-list enrichment is now behind the runner as `runMintListEnrichmentEffect()`.
The effect returns enriched mint rows, stale completion, and typed failure. The
machine still owns the background scheduling, current-step guard, fallback rows,
and the timing contract where handlers receive fallback rows before
immediately-settled enrichment lands.

Background recipient identity resolution is now behind the runner too.
`runRecipientPubkeyEffect()` and `runRecipientProfileEffect()` return resolved,
empty, failed, and stale results for Lightning Address → pubkey and pubkey →
profile resolution. The machine still owns fire-and-forget scheduling,
current-context application guards, step-data mirroring, and notifications.

NFC write-back is now behind the runner as `runNfcWriteBackEffect()`. The effect
creates the NFC send token, writes it to the tag, releases the session, rolls
back when write-back fails after token creation, and returns success
notification data, transaction-link intents, write-failure notification data,
stale completion, and typed failure. The machine still owns NFC auto-resolution,
execution flags, progress notification timing, step application, and handler
dispatch.

Re-check after the effect-runner slices: do not migrate to XState yet. The
effect surface is now explicit enough for a future prototype, but the remaining
custom machinery is still the shared runtime policy around lock lifecycle,
generation cancellation, handler dispatch, and side-channel state. A useful
XState prototype should delete one of those policies, not just wrap these named
effects.

Do not migrate to XState until this runner either proves the custom approach is
deep enough or exposes a named effect interface that an XState actor prototype
can replace with less code.

## External Reference

- XState v5 invoke docs: https://stately.ai/docs/invoke
- XState v5 overview docs: https://stately.ai/docs
