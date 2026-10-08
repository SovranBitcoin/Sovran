# 27. A payment timeline only ever adds rows

Date: 2026-10-08
Status: Accepted; native animation review outstanding.

## Context

The transaction timeline previewed the whole road ahead: three dots from the
first moment, the later ones greyed out. That made every early ending a
removal. A cancelled Lightning send dropped its first row; a locked send
dropped "Locked" the moment its date passed; a receive that had to wait for the
mint swapped to a different three-row timeline and back. Rows that fade out
mid-flow are what made the component look unsteady.

It also left states with nothing to draw. A send in `executing` or
`rolling_back` rendered an empty card. A melt that was still reversing claimed
"Cancelled, funds returned". A mint that failed after the payer had paid
replaced "Payment received" with "Failed". And a finished row kept its
present-tense label: "Sending ✓", "Waiting for payment ✓".

The states themselves were enumerated from the sources rather than from the
screens: the NUTs, nutshell and cdk for what a mint can report; coco 2.0.0 and
cashu-ts 5.0.0-rc.4 for what the wallet can be in; and our own explorer for
what the chain adds on top.

## Decision

**A timeline is every event that has happened, in the past tense, plus exactly
one open slot: the event being waited on, in the present tense.** Nothing
further ahead is drawn.

Progress finishes the open slot and opens the next one beneath it. A failure,
expiry or reversal lands *in* the open slot. No transition has a row to take
away.

Each flow is an ordered list of events (`wallet/src/history/timeline/flows.ts`).
An event has two wordings — `active` and `completed` — so the tense turns when
it happens: "Creating token" becomes "Created", "Waiting for payment" becomes
"Payment received". The renderer crossfades a row whenever its label changes.

"How far did it get" is the furthest of three witnesses, so it can only
advance:

1. the events' own `done` predicates over the current state;
2. evidence a terminal state leaves on the entry (`doneThrough`): a token on a
   rolled-back send, `remoteState: PAID` on a failed mint, `updatedAt` against
   a locktime;
3. the rows the mounted card has already drawn (`doneRowKeys`), handed back to
   the model on the next build. `rolled_back` does not say from where; the card
   remembers.

The third is why a timeline opened cold on an old entry can show fewer rows
than the same payment watched live. It never shows a row that did not happen.

`rolling_back`, and a cancel tap the wallet has not answered, are drawn as an
in-flight "Cancelling" row in the open slot rather than as the outcome.

### The mint credits; the explorer only hints

For an on-chain deposit the mint is the authority. It credits the quote from
its own node, at its own depth, and nothing our explorer reports changes that.
Our mempool data is a heuristic for two things only: showing progress before
the mint says anything, and noticing when the mint is not going to.

- The chain rows ("Deposit detected", "Confirmed on-chain") follow our
  explorer, and say so by what they do not claim: neither says "received".
  "Payment received" does not exist on this flow; the only receiving row is
  "Added to wallet", which needs the mint.
- Our count reaching the depth opens "Waiting for mint to credit — deep enough
  by our count; the mint credits it once its own node agrees".
- Our count running three blocks past the requirement with no credit is no
  longer lag — but only against a depth the mint itself published. Against
  our fallback of six, a mint that wants more blocks would be reported as one
  that lost a deposit, so no warning is drawn from a guessed depth. The slot turns to a warning: "Not credited by the mint". NUT-30
  names the two deposits a mint never credits — one below its `min_amount`, and
  one it first detected after the quote expired — and the copy says exactly
  that and to contact the mint. The mint crediting later clears it.
- The mint crediting finishes both chain rows even if our explorer has shown
  nothing, and a finished row draws a full ring whatever our count is.

For an on-chain send the mint is the authority on the payment being finished
too. Our count reaching the depth does not draw "Confirmed": the transaction
we are counting can be a heuristic address-and-amount match, and the mint can
still reverse a melt it has not settled. It opens "Waiting for the mint — deep
enough by our count; the mint confirms it once its own node agrees".
"Confirmed" is the mint's PAID for a transaction we can see. PAID with nothing
on the explorer is the mint's word that it is settled and is shown as that
("Paid by the mint"), with "the mint reported no on-chain transaction" once two
reads agree; a transaction we have seen outranks that. The card's header is
read off the rows, not off either observer's raw state.

The same rule covers Lightning expiry: "Invoice expired — no payment was seen
before it ran out" is our clock's opinion, and the mint crediting afterwards
replaces it.

### Time

Two slots change wording with nothing but time passing, and the model returns
`recheckAt` so the card rebuilds at that moment without polling: a Lightning
payment still PENDING after two minutes ("Taking longer than usual. Your ecash
stays held until the mint reports it paid or failed" — a stuck HTLC can hold it
until its timelock), and a reversal still in flight after one ("Not finished
yet. It completes once the mint can be reached" — coco does not retry a
reversal that threw).

### What "added to wallet" needs

The mint having issued is not the wallet having the ecash. A remote ISSUED on
an unfinished operation proves the payment and no more, and an operation that
finished with a recorded reason (already issued, outputs not restorable) ends
"Not added". A failed mint crosses the history list as UNPAID; its real
verdict rides beside it (`operationState`) so the timeline can still say so.

## The states, and what each one draws

Rows are written `✓ finished` / `● open slot` / `✕ ended`.

| Flow | State (coco / mint / chain) | Timeline |
| --- | --- | --- |
| Lightning receive | `pending` · quote UNPAID | ✓ Invoice created · ● Waiting for payment |
| | `executing` · quote PAID | … ✓ Payment received · ● Adding to wallet |
| | `finalized` · ISSUED | … ✓ Added to wallet |
| | UNPAID past the invoice expiry | ✓ Invoice created · ✕ Invoice expired |
| | `failed` | ✓ Invoice created · ✕ Failed |
| | `failed` after PAID (e.g. 20007 on a paid quote) | … ✓ Payment received · ✕ Failed |
| | `executing → pending` (claim retried) | "Payment received" stays; slot reopens |
| | `pending`, mint says ISSUED, nothing restored | … ✓ Payment received · ● Adding to wallet |
| | `finalized` with a reason (nothing restored) | … ✓ Payment received · ✕ Not added |
| On-chain receive | UNPAID, nothing seen | ✓ Address created · ● Waiting for deposit |
| | seen in mempool | … ✓ Deposit detected · ● Confirming on-chain (ring) |
| | n of N blocks | same slot, ring fills |
| | seen, then gone (replaced / evicted / reorg) | same slot, warning: no longer in the mempool |
| | deep enough, quote still UNPAID | … ✓ Confirmed on-chain · ● Waiting for mint to credit |
| | three blocks past the depth, still UNPAID | same slot, warning: Not credited by the mint |
| | PAID / ISSUED | … ● Adding to wallet → ✓ Added to wallet |
| | PAID with no explorer data | the mint's credit proves both chain rows |
| Lightning send | `prepared` · UNPAID | ✓ Payment prepared · ● Ready to send |
| | `pending` · PENDING | … ✓ Ecash sent to mint · ● Paying |
| | PENDING for over two minutes | same slot, warning: taking longer than usual |
| | `finalized` · PAID (also straight from UNPAID) | … ✓ Paid |
| | UNPAID past the quote expiry | ✓ Payment prepared · ✕ Quote expired |
| | `rolling_back` | … ● Cancelling (warning after a minute) |
| | `rolled_back`, backed out ("User cancelled", or no reason) | … ✕ Cancelled |
| | `rolled_back` with any other reason | … ✕ Payment failed |
| On-chain send | UNPAID | ✓ Payment prepared · ● Sending to mint |
| | PENDING, no outpoint | … ✓ Ecash sent to mint · ● Broadcasting |
| | PENDING, in mempool | … ✓ Broadcast · ● In mempool (ring) |
| | PENDING, n of N blocks | same slot: Confirming |
| | broadcast, then gone | same slot, warning |
| | deep enough by our count, mint still PENDING | … ● Waiting for the mint |
| | PAID while our count is behind | … ✓ Confirmed (full ring) |
| | PAID, nothing on the explorer, no verdict yet | … ● Paid by the mint |
| | PAID with no outpoint | … ✓ Ecash sent to mint · ✓ Paid by the mint |
| | reversed (cdk intent failed before signing) | … ✕ Payment failed |
| Ecash send | `prepared` / `executing` | ● Creating token |
| | `pending` | ✓ Created · ● Waiting for recipient |
| | `finalized` | ✓ Created · ✓ Claimed |
| | cancel tapped / `rolling_back` | ✓ Created · ● Cancelling |
| | `rolled_back` (token existed) | ✓ Created · ✕ Cancelled |
| | `rolled_back` (no token) | ✕ Cancelled |
| Locked send | permanent lock | ✓ Created · ● Locked |
| | timed lock, before the date | ✓ Created · ● Locked, unlocks ‹date› |
| | timed lock, date passed | … ✓ Unlocked · ● Reclaimable / Waiting for recipient |
| | claimed before the date | ✓ Created · ✓ Claimed (no "Unlocked") |
| | taken back after the date | … ✓ Unlocked · ✕ Reclaimed |
| Pay a request | token being built | ● Creating token |
| | publishing to relays | ✓ Created · ● Delivering |
| | relays accepted | … ✓ Delivered · ● Waiting for recipient |
| | claimed / taken back | … ✓ Claimed / ✕ Cancelled |
| | reopened from history (record only) | same rows, from the payer record and its transport |
| Ecash receive | `prepared` | ✓ Token accepted · ● Ready to redeem |
| | `executing` (mint unreachable) | ✓ Token accepted · ● Waiting to redeem (warning) |
| | `finalized` | ✓ Token accepted · ✓ Added to wallet |
| | `rolled_back`, mint said spent (11001) | … ✕ Already spent |
| | `rolled_back`, any other reason | … ✕ Not added |
| Receive a request | request live | ✓ Requested · ● Waiting for payment |
| | attempt received | … ✓ Payment received · ● Adding to wallet |
| | `finalized` / `rolled_back` | … ✓ Added to wallet / ✕ Already spent |

Every row of this table is a path on the Design System's Timeline page: the
top tabs choose the payment type, the pills choose the path, and the card plays
it from first state to last.

## What still has no representation

These can happen and the timeline cannot yet say so, because the input it would
need does not reach the model. Tracked in
[follow-ups](../../../docs/architecture/follow-ups.md) F64.

- **Why the mint did not credit.** The warning names both causes because the
  wallet cannot tell them apart: the mint's `min_amount` and the quote's expiry
  are not carried to the timeline, and our explorer does not report per-output
  amounts against them.
- **Mint unreachable**, for anything other than a token receive. A waiting
  mint or melt looks the same whether the mint is slow or offline, until the
  slow wording appears.
- **Replacement as such.** A dropped transaction is noticed; whether it was
  replaced by another paying the same address is not.
- **Reusable quotes.** BOLT12 and on-chain mint quotes can be paid more than
  once; `amount_paid` and `amount_issued` never reach the entry, so a second
  payment or a partial issue has no row.
- **Fees and change** on a settled melt (`changeAmount`, `effectiveFee`) and
  the preimage or outpoint that proves it.
- **A row drawn from the explorer outlives the observation.** Rows are never
  taken back, so "Confirmed on-chain" stays ticked if our explorer later
  loses the transaction or the mint turns out to want more blocks than we
  assumed. The slot beneath it stops claiming our count is deep enough, but
  the tick above it stands.
- **Lock details arriving after the card is drawn** change the flow (a plain
  send becomes a locked one) and can insert "Unlocked" above a finished row.
- **A verdict corrected by evidence.** "Paid by the mint" becomes "Broadcast"
  if an outpoint turns up late.
- **Reasons are read from coco's wording.** Cancellation, "nothing restored"
  and "already spent" are recognised by matching error text; coco exposes no
  structured reason.
- **Who redeemed a token.** A spent proof says the token was redeemed, not by
  whom; the copy says only that.

## Consequences

- The row count never goes down, so the card never animates a row out. The
  price is that the user no longer sees how many steps remain.
- The confirmation ring is not previewed before a deposit exists.
- The cancellation overlay moved from the card into the model, so a cancel tap
  and coco's own reversal share one row.
- An independent audit (Codex, 2026-10-08) of every transition found eleven
  defects in the first version of this design, and an adversarial pass by two
  reviewers (Codex and Claude) found seventeen more counterexamples in the
  second. All but the ones listed above are fixed and covered by tests. Most
  were not in the engine but around it: the entry merge keeping stale fields,
  one payment arriving under two ids, a hook showing one quote's state on
  another, and a ring rounding 49 of 50 up to full.
- The card's memory follows the payment (`operationId`, else `quoteId`), not
  the entry id, which alternates between the history and operation streams.
- A state no flow can read draws one row, "Status unavailable", instead of an
  empty card.
- Remembered rows are scoped to the flow they were drawn for. A row key means
  something only inside its own flow, so an entry that resolves to a different
  flow (lock data arriving late) starts its memory again.
- `wallet/__tests__/unit/timelineBruteForce.ts` (run twice: with the reclaim
  gate on, and as shipped) walks every combination
  of inputs per flow, including the backwards steps (a mint stepping back to
  `pending`, a quote falling from PENDING to UNPAID, the chain doing anything)
  and the observers moving after the operation has ended,
  and fails on any removed, reordered, reopened or blank row, on a finished row
  that kept its wording, and on a model that is not stable when rebuilt from
  its own rows. `app/__tests__/timelineScenarioProps.test.tsx` repeats the
  add-only check on the mounted component for every showcase path.
- Not yet looked at on a device. The crossfade on a label change and the
  in-place morph of the open slot need a visual pass on iPhone and Android.
