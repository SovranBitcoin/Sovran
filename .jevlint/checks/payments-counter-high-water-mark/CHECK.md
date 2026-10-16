Where can a keyset's deterministic-secret counter be read, restored or written below the highest value already saved?

Find the counter store and its write queue (app/shared/lib/cashu/cocoRepositories.ts), wallet
restore, and every reader that derives secrets from the counter. Reusing an index reuses a
secret. Concerns: a read that answers with a literal or a stale value while a higher write is
queued or has landed; a restored keyset left at 0 while proofs for it are held; a write that
lowers the saved value; interleaved reads and writes with no ordering. A counter that only moves
forward, and a read that reports what the queued task found or saved, are correct.
