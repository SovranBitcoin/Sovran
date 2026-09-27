# 16. The lock lives in the amount header, and every locked send is asked for

Date: 2026-09-27
Status: Accepted; native verification outstanding.

Supersedes, in [ADR 0011](0011-explicit-lock-method-and-provider-ownership.md),
the rule that a flow which arrives locked sends on its seeded terms without
asking. Restores the header control [ADR 0010](0010-p2pk-locked-sends.md)
introduced, alongside the "Lock Ecash" row ADR 0011 added rather than instead
of it.

## Context

The amount screen said "P2PK locked" in a pill under the number. ADR 0010
already called that pill "true and useless": it named a mechanism, not who
could take the money or when the sender could have it back. It also sat in the
one place on the screen that is about the amount.

Meanwhile the flows disagreed about asking. A send to a person opened a sheet
naming the recipient and offering durations. A Nut Drop, and a scanned wallet
receive key, locked permanently and said nothing: the sender learned that the
money could never come back only if they went looking in the timeline.

## Decision

### The header shows the lock and the sendability

Every ecash amount screen puts two things in `headerRight`: a lock (closed or
open) and whether the amount can leave without a network. The pill is removed.

A locked send always shows "network required", whatever proofs the wallet
holds. A lock is made by a swap at the mint, so an exact-match amount that
could be handed over offline as a bearer token cannot be handed over locked.

Inside the Nut Drop radar the bar belongs to the radar, not to the amount
content. The content hands its status up (`onHeaderStatus`) rather than the
radar re-deriving it, so there is one owner of what the lock is.

### One question, asked of every locked send

Before a locked send leaves, the sender has answered the same sheet: it is
titled with who the ecash is locked to, and each choice says how long and
whether the sender can take it back. It can be answered early, by tapping the
lock, or it is asked when Next is pressed. It is not asked twice. Backing out
of it sends nothing.

Who owns the choice differs by flow, and is the only thing that does:

| Flow | Lock | The sender chooses |
| --- | --- | --- |
| A send to a person | off by default | whether, and how long |
| Nut Drop, scanned wallet receive key | required | how long |
| Payment request | set by the request | nothing |
| No recipient (Create Ecash) | unavailable | nothing |

A payment request is the exception to "asked how long". Its NUT-10 option
dictates the secret, and adding a locktime and refund key to it would pay the
requester something other than what they asked for. The header shows it as
locked and the lock explains why there is nothing to choose.

### The unlock time is counted from the send

The kept choice is the duration, not a timestamp. "Reclaim after 1 hour"
answered ten minutes before pressing Next is an hour from the send. The choice
is dropped when its key no longer matches the payment, and at the root of
every payment flow, because the plain Next now sends on it.

## Consequences

- **A Nut Drop now takes one more tap**, and can be made reclaimable. Before,
  every Nut Drop was permanent.
- **A timed lock makes the token larger** (a locktime and a refund key per
  proof), and a Nut Drop token travels as one Bluetooth message. Whether a
  many-proof timed token still fits has not been measured.
- **A timed Nut Drop that arrives after its locktime is not auto-redeemed.**
  The mesh classifier auto-redeems only a token whose sole current signer is
  the receiver, and past the locktime the sender's refund key can sign too. A
  token is classified when it arrives, so this needs a delivery delayed beyond
  the chosen duration; the shortest duration is an hour.
- **Not proven on a device.** The sheet, the header on both platforms and the
  radar hand-off are covered by unit tests. `send.cashu.header-lock` is
  authored and has not been run.
