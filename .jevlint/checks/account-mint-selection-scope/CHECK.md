Where are mints chosen or listed for a payment flow, and does each place start from the active account's mints?

Find mint selection and its candidates: automatic mint choice, amount-entry pickers, the
payment-request and fallback paths, NFC and nearby flows (wallet/src/machine/contextResolution.ts,
wallet/src/machine/resolveNext.ts, requestMintSelector). The rule is that candidates are built
from the active account's mints by name. A mint from the other account that is left out only
because it currently reads as unsupported or zero-balance is a concern: with a balance it would be
picked and money would leave the wrong account. The wallet's own picker lists both sides by
design.
