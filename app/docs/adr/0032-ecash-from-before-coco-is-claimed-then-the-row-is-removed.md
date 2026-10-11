# 32. Ecash from before Coco is claimed, then the old row is removed

Date: 2026-10-11
Status: Accepted; no device of that age exists, so it is proven on fixtures only.
Supersedes [ADR 31](0031-ecash-from-before-coco-is-not-imported.md).

Builds 0.0.1 to 0.0.40 kept ecash in one redux-persist row, `persist:SOVRAN`. ADR 31
left that ecash where it was. The owner reversed that: ecash should not sit in a row
nothing reads, it should not be deleted either, and the app should not try for ever.

## The claim

The proofs in the row are bearer proofs. The mint honours whoever presents them first,
so the seed the old app derived them from does not matter, including the raw-key seed
of 0.0.12 build 3 and earlier. For each old profile, mint and keyset the app:

1. Leaves out any proof this wallet already stores. Releases 0.0.45 to 0.1.1 copied
   the proofs into Coco as they were, and receiving one again would spend the wallet's
   own copy.
2. Asks the mint which of the rest are spent (NUT-07). Spent proofs are recorded and
   never asked about again.
3. Hands the unspent ones to Coco's receive, which swaps them for proofs the open
   wallet derives. Nothing is written into Coco's tables directly.

It runs in the background after the wallet's own recovery sweeps, one mint at a time.
A phone with no row makes no request. The engine is `wallet/src/legacy-ecash`; the
app supplies storage, Coco and the mint client in `app/shared/lib/cashu/legacyEcashClaim.ts`.

An old profile whose public key is an account on this phone is claimed into that
account, which is also where 0.0.58 to 0.1.1 imported it. Any other old profile is
claimed into account 0: old profiles each stored their own phrase, so matching by
position is not certain, and bearer proofs are safe in any account the person owns.

Releases 0.0.45 to 0.0.56 imported every old profile into account 0's wallet, unswapped.
So claiming is two steps. First, with account 0 open, every group's proofs are compared
with that wallet, whichever account the group belongs in; proofs found there are finished
with and the group is marked as compared. Second, only the rest is claimed, into the
group's own account, when that account is open. A group that belongs in another account
therefore waits until account 0 has been opened once on this build, and until then no
request about it leaves the phone. A phone with no account 0 has no such wallet (removing
an account deletes its database), so the comparison is recorded as skipped for that reason,
and unmatched profiles go to the lowest account that exists; the target is worked out from
the profile list on every run.

A run belongs to the wallet it started with. After every wait, and before every write
and every receive, it checks that this wallet is still the open one, and stops without
writing if it is not. Delete-all closes the wallet before it clears storage, so a run
in flight cannot put its records back.

## Where it stops

Each group ends in one of these, recorded in `legacy-ecash-store`:

- **Settled.** Every proof is in the wallet or spent. Final.
- **Could not claim.** The mint no longer has the keyset, rejects the proofs, or the
  wallet refuses them; or five attempts failed, spaced one hour, one day, three days
  and seven days apart. Final. The proofs stay in the row. When the mint rejects a
  batch as invalid, the batch is halved until the bad proofs are found, so the good
  ones are still claimed.
- **Waiting for trust.** The mint is not one the wallet trusts. It is never trusted
  automatically. A prompt asks, and returns a day after it is closed, until the person
  adds the mint from its own page or declines.
- **Left unclaimed.** The person declined. The proofs stay in the row, and adding
  the mint later reopens the group.

A receive is recorded as started, and that record confirmed on disk, before the mint
is asked to swap. If the app dies in between, the next launch reads Coco's own
operation record and counts the value once.

Lightning receives the old app never recorded as paid are looked up at the mint. Both
stored shapes are read: `quote` on the transaction up to 0.0.12, `mintQuote.quote` after.
Only a positive answer counts as nothing to claim: the quote is issued, it is unpaid and
past its expiry, or the mint says in so many words that it has no such quote (nutshell:
code 0, "quote not found"; cdk: code 50000, "Unknown quote"). Neither mint has an error
code of its own for that, and cdk uses 50000 for unrelated failures too, so the wording
is matched exactly and anything else is not an answer. An unanswered lookup is retried on
the same schedule as a group and then recorded as unresolved. A paid and unminted quote
is recorded but not minted (follow-up F97). Both keep the row.

## Removing the row

The row is removed, and a note of what was claimed is kept, only when all of these hold:

- every group is settled;
- no old invoice is paid and unminted, and none is unresolved;
- the reader skipped nothing it could not understand;
- every phrase in the row is identical to the one in SecureStore.

Otherwise the row is left exactly as it was. Proofs that were neither claimed nor
confirmed spent are never deleted.
