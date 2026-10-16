Where can a stale async result mutate state after a profile, wallet or mint switch, or after a newer flow or request generation superseded it?

Find async work that writes to a store after an await, and the identity or generation guard that
checks ownership before the write (wallet/src/machine/createMachine.ts,
app/shared/lib/cashu/profileScopedStorage.ts). Results belong to the identity that started the
work. A cache keyed by the original identity may keep that owner's result. Committed payment work
still needs reconciliation even when its preparation was superseded.
