# 10. Locking ecash to a nostr identity: which key, which promise, and who can take it back

Date: 2026-09-24
Status: Accepted

## Context

Sovran used to lock ecash automatically when you sent it to a nostr contact:
`app/currency.tsx` passed `p2pk: { pubkey: maybeConvertNpub(profile.npub) }` into `sendEcash`, so
picking a person *was* the lock. That disappeared on 2025-10-01 in `f3ea7f24` ("Integrate Coco
Cashu and migrate from custom Redux") — the rewritten handler dropped the argument — and the
orphaned helper was deleted on 2025-12-05. Neither commit mentions P2PK. Since then the only
locked send has been Nut Drop, over BLE.

A bearer token is the right default for a lot of payments, but it is the wrong one for "send this
to Alice": anyone who sees the bytes can claim it, including anyone who sees a screenshot. And the
one question users ask about a lock — "can I get this back if they never claim it?" — had no answer
in the app at all.

NUT-11 gives three outcomes, and they are genuinely different:

- a **permanent** lock: only the recipient, ever;
- a locktime **with** a `refund` tag: the sender can take it back afterwards, while the recipient
  can still claim at any time;
- a locktime **without** one: after it passes, *anyone holding the token* can spend it.

No wallet in the ecosystem distinguishes these to the user. cashu.me and macadamia never set a
locktime, so their locks are permanent and a typo'd key is unrecoverable. minibits offers
`1 day / 1 week / forever` and calls the timed ones reclaimable — but it never emits a `refund`
tag, so its "reclaim" is a race with the public. None of the three display locktime, refund keys or
multisig anywhere.

## Decision

### Lock to the key they asked for, and say when we are guessing

NIP-61 puts a recipient's nutzap preferences in a `kind:10019` event, including the pubkey to lock
to — deliberately not necessarily their identity key, since NIP-60 keeps a separate wallet key for
exactly this. We read it, and fall back to `02` + their nostr x-only key when they have not
published one, which is almost everybody.

The fallback is **flagged, not hidden**: `source: 'identityFallback'` is the one signal the UI turns
into "we couldn't confirm they can unlock this". That single shape is also the entire failure mode —
absence, a malformed event and a timeout all resolve to it — so there is no second nullable path
for a caller to mishandle.

Parity is kept as scanned. NUT-11 compares keys by x coordinate, but the holder signs for the key
they published: locking an `03` key to our `02` lift of it produces a token they cannot redeem.

### A locktime without a refund key is refused, not corrected

`normalizeP2pkLock` rejects both shapes NUT-11 allows and a sender would not want: a locktime with
no refund keys (past it, anyone holding the token can spend, while the sender was told the
opposite) and refund keys with no locktime (a path that can never open — cashu-ts throws on the
same shape). A malformed lock aborts the flow rather than quietly degrading to a bearer token.

### The mint gate blocks; a mint mismatch only warns

Coco's `P2pkSendHandler` throws unless the mint advertises NUT-11, so offering the toggle there
would promise a send we cannot make: that is a hard block. A recipient whose `kind:10019` lists
other mints can still claim — the lock is to their key, not to a mint — so that is a warning. And a
mint we have not read yet is neither: unknown is not "no".

### Delivery stays NIP-17

The token still travels in the encrypted DM that contact sends already use. It is what minibits and
macadamia do, and no wallet ships NIP-61 nutzaps (`kind:9321`) yet. `ContactSendTarget.delivery`
names the channel so a nutzap branch can be added beside it; publishing our own `kind:10019` waits
for the receive half, because advertising an inbox we do not service would be a lie.

This also fixed a real bug: `sendComplete` read "this send has a P2PK lock" as "this was a Nut
Drop", so a locked contact send skipped the DM entirely.

### Locktime and reclaim ship together

A `refund` tag we cannot spend is worse than minibits' footgun — we would be minting tokens only
*other* wallets could refund. So the duration picker depends on the reclaim working, and coco is
patched (`app/patches/@cashu+coco-core+2.0.0.patch`) to make it work.

Coco refused every pending P2PK rollback: the note in its handler says P2PK tokens "cannot be
reclaimed without the private key", which is exactly right and exactly why the handler needed one.
The patch gives it the keyring and asks cashu-ts which pubkeys may spend each proof *right now* —
main keys while the lock holds, refund keys once the locktime has passed. That timing is the
feature. The private key never leaves coco: the app supplies only public keys, to decide whether to
*offer* the action.

An app-layer sweep was rejected for that reason. It would have had to pull a raw private key out of
the keyring into JS, undoing the in-memory-overlay decision in `cocoRepositories.ts` for a fee
saving.

### The conditions are shown, not summarised

The old "P2PK locked" pill was true and useless. Each state now gets its own sentence, because each
is a different amount of risk, with the keys, dates and thresholds in a disclosure. Where the model
cannot know something it says so: unknown conditions, a hash lock, a multisig this wallet cannot
sign, a partially-locked token. Blinded keys (NUT-28) are deliberately **not** claimed — detecting
them needs private keys and an ECDH step a display model has no business doing, so an undetected
P2BK proof reads as "locked to someone else", which is the safe direction to be wrong in.

## Consequences

- **A locked send cannot be cancelled**, and the UI now says which kind of "no" it is rather than
  offering a button the mint will refuse. Reserved and cancellable became separate predicates so
  the balance keeps counting locked sends as spent.
- **We carry a patch.** Its removal trigger is coco reclaiming P2PK sends upstream; a guard test
  asserts the shipped bundle still contains the signing path, so a version bump cannot drop it
  silently.
- **Foreign locked tokens still cannot be claimed via a refund key.** Coco's claim path signs only
  by exact lookup of `Secret.data` and rejects multisig. Our own reclaim does not go through it, so
  this feature does not need it; the conditions card states the limitation rather than offering a
  redeem that fails.
- **Not yet proven on a device** (follow-up F54). The reclaim path is unit-tested and asserted to
  exist in the shipped bundle, but it has never moved money against a live mint.
