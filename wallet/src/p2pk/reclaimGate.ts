// ---------------------------------------------------------------------------
// Whether this wallet can take a locked send back.
//
// It cannot. Coco refuses to roll back a P2PK send once it has left — upstream
// declares `canReclaim = false` on the handler — and its receive path signs a
// locked proof with the key in the secret's `data` field only, never a refund
// key. Nothing in the unmodified wallet core can spend the refund path, and
// the core is shipped unmodified.
//
// So while this is off no timed lock is offered, created or promised. A
// locktime with a refund key nobody can use is a permanent lock that tells the
// sender otherwise, which is worse than the permanent lock it replaces.
//
// One flag, read by everything that would otherwise say "you can take this
// back": the lock menu, the lock a send is allowed to apply, and the verdict
// the cancel rule, the timeline and the pending-send screen are built from.
//
// Turn it on when the wallet core can sign the refund path itself.
// ---------------------------------------------------------------------------

// Annotated rather than inferred: as the literal `false` every branch behind
// the flag would be unreachable to the type checker.
export const P2PK_RECLAIM_ENABLED: boolean = false;
