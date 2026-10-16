Where can an executed or persisted monetary amount lose its unit, its precision, or the difference between unknown and zero?

Find unit conversions, numeric parsing and defaults applied to amounts, fees and balances
(Number(), parseInt, parseFloat, toFixed, Math.*, ?? 0, || 0), and wallet/src/amount.ts, which owns
amount semantics: amountToNumber is for display only, amountToNumberOrUndefined keeps unknown apart
from zero, and requireAmount guards a value that is executed or compared as money. A private copy
of any of these, or display coercion on an executed amount or fee, is a concern. Zero is a valid
amount in some states; a missing or unknown amount must not become a confirmed balance or an
executed amount. Display-only rounding that cannot change the executed payment is correct.
