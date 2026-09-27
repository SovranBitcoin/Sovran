# 17. The wallet core ships unmodified, and timed locks wait for it

Date: 2026-09-27
Status: Accepted; native verification outstanding.

Amends [ADR 0016](0016-the-lock-lives-in-the-amount-header.md): every locked
send is still asked for, but the only length on offer is forever.

## Context

The lock sheet offered "Reclaim after 1 hour / 1 day / 1 week / 30 days". Each
is a NUT-11 lock with a locktime and a refund key of ours, and a promise that
the wallet can spend the refund path once the lock opens.

Coco cannot. At 2.0.0 its send service refuses to roll back a pending P2PK
send, and its receive path signs a locked proof with the key in the secret's
`data` field only, never a refund key. Upstream has since made the position
explicit: `P2pkSendHandler.canReclaim = false`.

The promise was kept by a patch to `@cashu/coco-core`. It removed the refusal,
gave the P2PK handler the keyring, and added a reclaim that signed the send
proofs, swapped them at the mint and saved the results as ready proofs. It had
never run against a mint. It also raised its own refusal after the service had
recorded the send as rolling back, which left a refused send in a state
`reclaim` rejects and `finalize` skips.

## Decision

`@cashu/coco-core` ships as published. No patch is registered against any coco
package, and `app/__tests__/cocoCoreUnmodified.test.ts` fails if one returns.

What the core cannot do, the app does not offer. `P2PK_RECLAIM_ENABLED` in
`wallet/src/p2pk/reclaimGate.ts` is the one switch, and it is off:

| Where | While the gate is off |
| --- | --- |
| Lock menu | No timed row is listed. "Lock forever" is the only lock; "Don't lock" remains where the flow allows it. |
| A kept choice | A timed choice from earlier is not honoured. |
| `normalizeP2pkLock` | Refuses any locktime. Every send's lock passes through it. |
| Reclaim verdict | `never`, so the cancel rule, the timeline and the pending-send screen stop saying a locked send can be taken back. |

A timed lock is withheld rather than sent without a way back. A locktime with a
refund key nobody can use is a permanent lock that tells the sender otherwise.

## Consequences

A sender who locks ecash cannot take it back, as in 0.1.3.

Cancelling a locked send that has left is refused by coco before any state
changes, so the send stays pending and finalizes when the recipient claims it.
The transaction list still offers cancel for any pending send, and for a locked
one that tap fails and changes nothing; it did the same in 0.1.3.

The timed-lock code and its tests stay. Those tests switch the gate on, so the
behaviour remains specified. `wallet/__tests__/unit/reclaim-gate.test.ts` and
`app/__tests__/sendLockReclaimGate.test.ts` leave it off and assert what ships.

Turning the gate on needs a wallet core that signs the refund path itself,
released upstream. It does not need a patch, and must not be done with one.

## Evidence and limits

The installed `dist/` of `@cashu/coco-core` was compared file by file with the
published 2.0.0 tarball and is identical. The refusal and the unchanged state
are asserted against the installed bundle with in-memory repositories.

Nothing here was run on a device or against a mint. A timed send created by a
development build before this change keeps its locktime and refund key; this
wallet will report it as not reclaimable.
