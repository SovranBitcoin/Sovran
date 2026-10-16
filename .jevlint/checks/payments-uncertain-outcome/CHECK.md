Where is an uncertain payment outcome recorded as confirmed success or definitive failure?

Find how melt, mint, swap and send operations handle a timeout, disconnect or unknown response,
the state machine that owns the result (wallet/src/operations/defaultOperations.ts,
wallet/src/history/states.ts), and the tests of those paths. A timeout or unknown response is not
proof the effect failed: the operation identity and uncertain state must survive until
reconciliation. A swap or rebalance leg whose money has not been seen to arrive is settling, not
done, and a settling step must not be run again by a retry. A result confirmed by the mint, or
reconciled afterwards, is correct.
