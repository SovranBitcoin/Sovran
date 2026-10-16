Where is a promise awaited with no time limit while the account lock is held?

Find the code that takes and releases the account lock (app/shared/lib/profile/profileTransition.ts,
profileSessionOrchestrator.ts) and every await between the two: wallet close, key derivation,
storage reads and writes, wallet inspection, network calls. One promise that never settles keeps
the lock, and every other account flow is refused until restart. settleWithin
(app/shared/lib/profile/settleWithin.ts) is the bound. Removal is deliberately unbounded, because
giving up part-way through a deletion is worse than waiting; a bounded wait that then replaces
data under a wallet that may still be writing is also a concern.
