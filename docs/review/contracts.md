# Contracts for semantic review

This document supplies domain meanings to the configured questions. Source paths below identify
owners for a human investigation; their contents are not automatically present in a Jev request.
A missing implementation or caller is unknown, not evidence that a guard is absent. Judge changes
against visible evidence. Tests may intentionally construct bad inputs and fake failures.

## Secrets and wallet recovery

A locked or unreadable secure store does not mean a seed is absent. Existing but invalid mnemonic
material must not be overwritten by generated recovery material. `ensureMnemonicExists` in
`app/shared/lib/nostr/secureStorage.ts` separates those outcomes before generation. Mnemonics,
private keys, bearer payment material and decrypted private messages must not enter logs, analytics,
public relay payloads or unencrypted persistent stores.
Encrypted storage, intended encrypted transfers and deliberate user backup/export are legitimate flows.

## Payment effects and cancellation

A timeout, disconnect or unknown response is not proof a mint/payment effect failed. Preserve the
operation identity and uncertain state until reconciliation; do not retry a potentially committed
spend as a new operation. Inspect `wallet/src/operations/defaultOperations.ts` and
`wallet/src/history/states.ts` for the owning state machine.

Cancellation and rollback are state-dependent. `wallet/src/screen-actions/defaultHandlers.ts` and
`app/shared/lib/cashu/utils.ts` distinguish operation states. Do not mark proofs spendable, erase
reconciliation evidence or claim a refund solely because a local screen closed or transport failed.
An explicitly confirmed uncommitted operation may be cancelled safely.

Validated payment requests carry amount, unit, mint and locking constraints. Preserve applicable
constraints through execution. A `mintsPreferred` list is advisory: `defaultOperations.ts` may
remove `mints` from an SDK input copy while retaining the original request as flow identity. `wallet/src/payment-request.ts` legitimately returns null for an
undecodable/unsupported request; that result alone is not a hidden payment failure.

## Ownership and durable state

Async work belongs to the profile/wallet/mint identity that started it. `wallet/src/machine/createMachine.ts`
and `app/shared/lib/cashu/profileScopedStorage.ts` own these boundaries. After identity switches,
results must not mutate the newly selected owner's store. Superseded flow/request generations
within the same identity must also reject stale preparation results. Committed payment work
still needs reconciliation; invalidating preparation is not proof a spend was cancelled. A cache keyed by the original identity
can legitimately retain that owner's result.

Persisted user state is durable input. `app/shared/lib/persist/createMergeWithSchema.ts` validates
the persisted projection; an invalid field can reject the entire blob. Removing or tightening
persisted schema values needs tolerant decoding or a versioned migration. Do not silently replace
unreadable/invalid wallet authority with an empty store. Ordinary ephemeral cache misses may use
empty defaults. Relevant schemas/migrations may be outside the supplied window: abstain then.

## Nostr identity and delivery

Retry publication of the same signed event with its original event id; re-signing or changing the
payload creates another event. Signing a genuinely new user action is allowed.
`app/shared/lib/nostr/publish/publishEvent.ts` owns retries.

The first relay OK may mark local optimistic publication successful while background fanout
continues. It is not recipient receipt or guaranteed global delivery. This is intentional in
`app/docs/adr/0001-optimistic-publish-and-own-content-store.md`; own-content stores stay author-scoped.
Encrypted direct messages follow `app/shared/lib/nostr/publishGiftWrappedDM.ts`; their intended
recipient must be able to decrypt, but public relay observers must not receive plaintext secrets.

## Amounts

Amounts need their currency/unit and conversion meaning. `wallet/src/amount.ts` owns wallet amount
semantics. Zero is a valid amount in some states; missing/unknown amounts must not silently become
confirmed balances or executed amounts. Preserve precision across unit conversions; display
rounding is allowed when it cannot change the executed payment.

## Status notices

A status notice is a short warning, error, caution or informational message shown beside a status
icon on its own tinted surface, inside a page, card or sheet. `Notice` in
`app/shared/ui/composed/Notice.tsx` is the only one. It carries the whole range: `status` picks
`info`, `warning` or `danger`, `tone` picks a solid fill that interrupts or a soft tint that sits
beside other content, `size` picks the page scale or the compact scale used in dense sheets and
chat strips, and `icon` and `action` cover a custom glyph and a trailing recovery affordance. A
hand-built equivalent drifts: it is how `#f59e0b` and a private 8% danger tint reached the app.

Distinct shapes with their own owners are not notices and must not be folded into one: full-screen
error and empty states (`EmptyState`), the screen-wide offline banner in `OfflineProvider`,
interactive call-to-action cards, badges and pills carrying no status sentence, per-field
validation text under an input, and bare tinted copy with no surface of its own.

A small named component whose body is a `Notice` fixed at one surface's geometry is the intended
way to share that geometry across call sites — `TransferErrorBanner` and `ChatStatusStrip` are the
examples. Notice's own implementation and the design-system catalogue screens under
`app/features/settings` are excluded by definition.
