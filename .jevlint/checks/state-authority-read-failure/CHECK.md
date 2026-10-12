Where is a failed or invalid read of durable wallet authority treated as an empty first-run store?

Wallet authority is durable state that existing funds depend on: seeds, keyset counters, proofs
and their stores. Find where it is read at start-up or hydration, what the failure branch does, and
any initialization that can then replace it. Existing authority must not be silently replaced by
an empty store. Empty defaults for an ordinary ephemeral cache miss are correct.
