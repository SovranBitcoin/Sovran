import { extractDomain } from '@/shared/lib/url';
import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';

type BalanceMap = Record<string, { total?: AmountValue } | undefined>;

interface ManagerLike {
  wallet: { balances: { byMint: () => Promise<BalanceMap> } };
  mint: { untrustMint: (url: string) => Promise<void> };
}

export interface StrandedMint {
  url: string;
  balance: number;
}

export interface ReleaseTrustWindowResult {
  stranded: StrandedMint[];
  untrustErrors: { url: string; error: unknown }[];
}

/**
 * Release the bounded trust window acquired around a middleman-routed
 * rebalance. Invariant: every URL in `temporarilyTrusted` is run through
 * `untrustMint`, regardless of remaining balance. URLs with non-zero balance
 * are returned as `stranded` so the caller can surface them — the trust
 * window must not outlive the operation, but the user still needs visibility
 * into where their funds ended up so they can re-trust to recover.
 */
export async function releaseTrustWindow(
  manager: ManagerLike,
  temporarilyTrusted: readonly string[]
): Promise<ReleaseTrustWindowResult> {
  if (temporarilyTrusted.length === 0) {
    return { stranded: [], untrustErrors: [] };
  }
  const balances = await manager.wallet.balances.byMint().catch(() => ({}) as BalanceMap);
  const stranded: StrandedMint[] = [];
  const untrustErrors: { url: string; error: unknown }[] = [];
  for (const url of temporarilyTrusted) {
    const balance = amountToNumber(balances[url]?.total);
    if (balance > 0) stranded.push({ url, balance });
    try {
      await manager.mint.untrustMint(url);
    } catch (error) {
      untrustErrors.push({ url, error });
    }
  }
  return { stranded, untrustErrors };
}

export function formatStrandedRoutingDetail(stranded: readonly StrandedMint[]): string {
  return `Funds remain on ${stranded
    .map((s) => `${extractDomain(s.url)} (${s.balance} sat)`)
    .join(', ')} — re-trust to recover.`;
}
