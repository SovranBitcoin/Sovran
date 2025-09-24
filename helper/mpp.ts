export interface MintBalance {
  mintUrl: string;
  balance: number; // in satoshi
}

/**
 * Allocate msats for a total amount across mints proportionally to their balances.
 */
export function msatAllocations(totalSat: number, balances: MintBalance[]): Record<string, number> {
  const totalBal = balances.reduce((sum, b) => sum + b.balance, 0);
  if (totalBal === 0 || totalSat <= 0) {
    return balances.reduce<Record<string, number>>((acc, b) => {
      acc[b.mintUrl] = 0;
      return acc;
    }, {});
  }

  const parts = balances.map((b) => {
    const raw = (b.balance / totalBal) * totalSat;
    const floor = Math.floor(raw);
    return { mintUrl: b.mintUrl, floor, frac: raw - floor };
  });
  const remainder = totalSat - parts.reduce((sum, p) => sum + p.floor, 0);
  parts
    .sort((a, b) => b.frac - a.frac)
    .slice(0, remainder)
    .forEach((p) => p.floor++);
  return parts.reduce<Record<string, number>>((acc, p) => {
    acc[p.mintUrl] = p.floor * 1000; // convert to msat
    return acc;
  }, {});
}

