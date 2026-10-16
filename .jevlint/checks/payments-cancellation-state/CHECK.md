Where does cancellation, rollback or a local failure release proofs, erase reconciliation evidence or claim a refund?

Find the cancel, abort, unmount and rollback paths for payment operations and the operation state
each one checks (wallet/src/screen-actions/defaultHandlers.ts, app/shared/lib/cashu/utils.ts).
The concern is marking proofs spendable or dropping evidence after the effect may already have
committed, because a screen closed or a transport failed. Cancelling an explicitly confirmed
uncommitted operation is correct.
