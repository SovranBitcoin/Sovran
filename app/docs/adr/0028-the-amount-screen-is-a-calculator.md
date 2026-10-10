# 28. The amount screen is a calculator

Date: 2026-10-08
Status: Accepted; iPhone and a funded send outstanding.

Supersedes, in [ADR 0016](0016-the-lock-lives-in-the-amount-header.md), the
rule that the lock and the sendability sit in `headerRight`. Everything else
in 0016 stands: who owns the lock choice, the one question asked of every
locked send, and the unlock time counted from the send.

## Context

The amount screen had not changed in a long time: a centred number, a pill
naming the currency, a borderless three-column keypad. It never showed the
amount in the other currency. The two facts that decide whether an ecash send
can happen at all, the lock and whether the amount needs the mint, were two
small icons in the navigation bar, away from the number they describe.

Several whole-screen designs were built behind a development switch and
compared on a device. One was chosen and the rest deleted.

## Decision

- **The screen is a pocket calculator.** The amount is centred in the space
  between the navigation bar (and the recipient's name, when there is one)
  and the keys, with the amount in the other currency on the line beneath
  it. It is placed off a fixed allowance for the bar, not the bar's measured
  height, which arrives a frame late and made the amount slide as the screen
  opened; pinning it directly under the bar was tried and had that shift. It has
  no surface of its own; a darker panel behind it was tried and rejected.
- **The display says one thing about delivery: `OFFLINE`**, with a plane, on
  the line under the amount, and only when the payment can complete with no
  network. Tapping that line swaps in the sentence that explains the current
  state, locked or not, offline or not. A row of four flags (`LOCK`, `MINT`,
  the carrier, `OFFLINE`) was built first and removed as more than the screen
  needs. The navigation bar carries none of this, on the route or inside the
  Nut Drop radar, so a lock is no longer visible on this screen until the
  line is tapped; the lock question is still asked as the ecash leaves
  (ADR 0016).
- **What `OFFLINE` means is one pure function**, `describeSendDelivery`, tested
  over every combination of lock, carrier and exactness. The mint is needed
  unless held proofs add up to the amount exactly
  ([ADR 0019](0019-an-exact-send-needs-no-mint.md)), and always for a lock.
  The carrier is the flow's, known before an amount is typed:

  | Flow | Lock | Carrier | Can be offline |
  | --- | --- | --- | --- |
  | Create Ecash, or "as Ecash" from a profile or chat | none, or the sender's | `SCAN` | unlocked and exact only |
  | A contact picked in Send | the sender's | `NOSTR` (NIP-17, automatic) | never |
  | Scanned wallet receive key | required | `SCAN` | never: the lock is a swap |
  | Nut Drop | required | `BLUETOOTH` (Nostr tried alongside when advertised) | never: the lock is a swap |
  | Payment request, Nostr only | the request's | `NOSTR` | never |
  | Payment request listing a server | the request's | `SERVER` | never |
  | Payment request, no transport | the request's | `SCAN` | not claimed |
  | AI-credit top-up | none | `SERVER` | never |

  A locked send is never offline whatever carries it, and a contact send is
  never offline whatever the amount. A request that lists both a server and
  Nostr is posted to the server, as `executePaymentRequest` does.
- **The keypad has a fourth column of function keys**: delete, the currency
  swap (named for the currency it switches to), `MAX`, and the note picker.
  The column is as tall as the digit block whatever it holds, and a key has
  to stay gone for a moment before the column drops it: a send reloads the
  wallet's proofs, and keys that came and went with them made the column
  jump. The sat keypad fills its decimal slot with `00` and offers `000`.
- **Held ecash is drawn as notes**, in the note picker: an `EcashNote` is a
  flat slip with serrated short edges, and an amount on one is an amount the
  wallet holds exactly. The amount screen itself carries no quick amounts; a
  strip of them above the keypad was tried and removed.
- **The recipient is one column under the bar**: the picture in the bar, "Pay
  <name>" under it, and the domain they claim under that. The claim's icon and
  colour say whether it checked out; it carries no sentence, and the key is
  not printed.
- **Notes can be picked by hand.** The notes key opens the note picker, a
  route (`app/notes.tsx`) presented like Details
  ([ADR 0026](0026-details-and-pickers-are-sheets.md)). It lists the mint's
  notes by denomination under a pinned total, with a step either side of the
  total that moves to the next amount the notes can make; the total goes back
  to the keypad. It sends nothing
  and reserves nothing: any amount it produces is an exact match, so the
  ordinary send then needs no mint. It is offered on an ecash send only.

## Consequences

- `amount-header-lock` and `amount-header-sendability` are gone; scenarios
  wait for `amount-delivery` and `amount-flag-offline`. `AmountHeaderStatus`
  and `CurrencySwapperPill` are deleted.
- The picker chooses an amount, not specific proofs. Coco picks the proofs
  when the send is prepared, and may use different notes of the same values.
- A payment request with no transport is treated as handed over directly,
  but the wallet has no hand-over screen for the token coco returns
  (`executePaymentRequest` discards it). That gap is older than this screen.
- A contact send whose Nostr message fails falls back to the token screen,
  where it can be scanned. The display describes the intended path.
- `MAX` is the ecash balance. It is not fee-aware: choosing "as Lightning"
  after `MAX` forwards the whole balance with no room for the fee reserve. A
  fee-aware Lightning maximum needs a quote loop in the wallet package and is
  not built.

## Evidence and limits

- The delivery table was checked against the code by an independent Codex
  audit, which corrected the request carrier order and the top-up row.
- Unit tests cover the delivery table (`sendDelivery.test.ts`), note picking
  (`notePicking.test.ts`) and the keypad's keys (`customKeyboardA11y.test.tsx`).
- Seen on an Android emulator in mock mode, through Receive → Fixed Amount
  with stand-in status, notes and picker data: mock mode cannot open a send.
  Not seen on iPhone, and not on a funded send. `note-picker` is registered as
  a canonical page with no scenario yet.
