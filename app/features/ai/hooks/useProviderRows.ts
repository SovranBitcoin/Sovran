import { useEffect, useMemo, useState } from 'react';

import { useBalanceContext } from '@cashu/coco-react';
import { routstrMintKey, spendableMintBalances } from '@/shared/lib/routstr/payingMint';
import { cachedProbe, type ProviderStatus } from '@/shared/lib/routstr/providerHealth';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

/**
 * Every known provider, with what the user needs to choose between them.
 *
 * Two derived figures do the work. **Spendable** is the sum of what the wallet
 * holds across the mints this provider will actually redeem — not the wallet
 * total, which says nothing about whether a given provider can be paid. And
 * **E2EE**, which is the one capability worth promoting: a provider running
 * models in an enclave cannot read the prompts it forwards, and that is a
 * different product from one that can.
 *
 * The ranking follows from that. E2EE first, then by spendable balance, then
 * by name. Health updates never move a row under the user's finger.
 */

export interface ProviderRow {
  baseUrl: string;
  name: string;
  description: string | null;
  version: string | null;
  mints: string[];
  e2ee: boolean | null;
  pubkey: string | null;
  status: ProviderStatus;
  /** Sats the wallet holds across the mints this provider accepts. A provider
   *  that publishes no mint list accepts any, so it gets the wallet total. */
  spendableSats: number;
  /** Why this provider cannot be chosen, or `null` when it can. */
  blockedReason: string | null;
}

const host = (baseUrl: string) => baseUrl.replace(/^https:\/\//, '');

/** What to say under a usable provider's name — ordered by what changes a
 *  decision: that your money works there, then whether it can answer
 *  privately. */
export function describeProvider(row: ProviderRow): string {
  const parts: string[] = [];
  if (row.e2ee) parts.push('End-to-end encrypted');
  if (row.spendableSats > 0) parts.push(`${row.spendableSats.toLocaleString()} sat spendable`);
  if (parts.length === 0 && row.description) parts.push(row.description);
  if (parts.length === 0) parts.push(host(row.baseUrl));
  return parts.join(' · ');
}

export function useProviderRows(probed: Record<string, ProviderStatus> = {}): ProviderRow[] {
  const knownProviders = useRoutstrStore((s) => s.knownProviders);
  const { balances } = useBalanceContext();

  const byMint = useMemo(() => {
    const out = new Map<string, number>();
    for (const [url, sats] of Object.entries(spendableMintBalances(balances.byMint))) {
      const key = routstrMintKey(url);
      if (key && sats > 0) out.set(key, sats);
    }
    return out;
  }, [balances]);

  const walletTotal = useMemo(
    () => [...byMint.values()].reduce((sum, sats) => sum + sats, 0),
    [byMint]
  );

  const ranked = useMemo(() => {
    const rows: ProviderRow[] = Object.entries(knownProviders).map(([baseUrl, provider]) => {
      const status = probed[baseUrl] ?? cachedProbe(baseUrl)?.status ?? 'unknown';
      const accepted = new Set(provider.mints.map(routstrMintKey).filter((url) => url !== null));
      // No published list means no restriction, so every sat is spendable
      // there. An empty intersection means none of it is.
      const spendableSats = provider.mints.length
        ? [...accepted].reduce((sum, mint) => sum + (byMint.get(mint) ?? 0), 0)
        : walletTotal;
      const blockedReason =
        provider.mints.length > 0 && spendableSats <= 0
          ? `Redeems ecash only from ${accepted.size === 1 ? 'a mint' : 'mints'} you do not hold`
          : status === 'offline'
            ? 'Not answering right now'
            : null;
      return {
        baseUrl,
        name: provider.name || host(baseUrl),
        description: provider.description,
        version: provider.version,
        mints: provider.mints,
        e2ee: provider.e2ee,
        pubkey: provider.pubkey,
        status,
        spendableSats,
        blockedReason,
      };
    });

    // Health updates change the badge, never the row's position under a finger.
    return rows.sort((a, b) => {
      const blocked = Number(a.spendableSats <= 0) - Number(b.spendableSats <= 0);
      if (blocked !== 0) return blocked;
      const e2ee = Number(b.e2ee === true) - Number(a.e2ee === true);
      if (e2ee !== 0) return e2ee;
      if (b.spendableSats !== a.spendableSats) return b.spendableSats - a.spendableSats;
      return a.name.localeCompare(b.name) || a.baseUrl.localeCompare(b.baseUrl);
    });
  }, [knownProviders, byMint, walletTotal, probed]);

  // Rank on entry. Discovery may append providers, but asynchronous metadata
  // must not move an existing choice while the user is reaching for it.
  const [order, setOrder] = useState(() => ranked.map((row) => row.baseUrl));
  useEffect(() => {
    setOrder((previous) => {
      const seen = new Set(previous);
      const additions = ranked.filter((row) => !seen.has(row.baseUrl)).map((row) => row.baseUrl);
      return additions.length ? [...previous, ...additions] : previous;
    });
  }, [ranked]);
  const positions = new Map(order.map((url, index) => [url, index]));
  return [...ranked].sort(
    (a, b) =>
      (positions.get(a.baseUrl) ?? order.length) - (positions.get(b.baseUrl) ?? order.length)
  );
}
