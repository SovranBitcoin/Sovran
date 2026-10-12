Where can an executed or persisted monetary amount lose its unit, its precision, or the difference between unknown and zero?

Find unit conversions, numeric parsing and defaults applied to amounts, fees and balances
(Number(), parseInt, parseFloat, toFixed, Math.*, ?? 0, || 0), and wallet/src/amount.ts, which owns
amount semantics. Zero is a valid amount in some states; a missing or unknown amount must not
become a confirmed balance or an executed amount. Display-only rounding that cannot change the
executed payment is correct.
