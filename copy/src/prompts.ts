/** Wording of the prompt that asks to trust a mint holding ecash from before 0.0.45. */
export const oldEcashClaimCopy = {
  title: "Claim your old ecash",
  /** `mint` is the mint's name or address; `amount` is null when it cannot be shown. */
  body: (claim: { mint: string; amount: string | null } | null): string => {
    if (!claim) {
      return "An earlier version of Sovran left ecash at a mint this wallet does not trust. Trust the mint to claim it.";
    }
    const ask = claim.amount
      ? `Trust ${claim.mint} to claim ${claim.amount}.`
      : `Trust ${claim.mint} to claim your ecash.`;
    return `${ask} An earlier version of Sovran received it from this mint, and the mint may keep a small fee. If you decline, it stays on this phone and you can claim it later by adding the mint.`;
  },
  review: "Review mint",
  later: "Not now",
  decline: "Don't claim",
} as const;
