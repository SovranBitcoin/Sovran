import { useMemo } from 'react';

import { useBalanceContext } from '@cashu/coco-react';
import { amountToNumber } from '@/shared/lib/cashu/amount';
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
 * by whether the provider is answering at all. Unusable rows sort last but are
 * never dropped — they stay, dimmed, with the reason.
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

const canonicalMint = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

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
    for (const [url, snapshot] of Object.entries(balances.byMint)) {
      const sats = amountToNumber(snapshot?.total);
      if (sats > 0) out.set(canonicalMint(url), sats);
    }
    return out;
  }, [balances]);

  const walletTotal = useMemo(
    () => [...byMint.values()].reduce((sum, sats) => sum + sats, 0),
    [byMint]
  );

  return useMemo(() => {
    const rows: ProviderRow[] = Object.entries(knownProviders).map(([baseUrl, provider]) => {
      const status = probed[baseUrl] ?? cachedProbe(baseUrl)?.status ?? 'unknown';
      const accepted = provider.mints.map(canonicalMint);
      // No published list means no restriction, so every sat is spendable
      // there. An empty intersection means none of it is.
      const spendableSats = accepted.length
        ? accepted.reduce((sum, mint) => sum + (byMint.get(mint) ?? 0), 0)
        : walletTotal;
      const blockedReason =
        accepted.length > 0 && spendableSats <= 0
          ? `Redeems ecash only from ${accepted.length === 1 ? 'a mint' : 'mints'} you do not hold`
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

    // Usable before blocked; inside that, end-to-end encryption before
    // everything, then the deepest pocket, then whoever is actually answering.
    // Name last so the order is stable between launches rather than following
    // whatever order discovery happened to return.
    return rows.sort((a, b) => {
      const blocked = Number(a.blockedReason != null) - Number(b.blockedReason != null);
      if (blocked !== 0) return blocked;
      const e2ee = Number(b.e2ee === true) - Number(a.e2ee === true);
      if (e2ee !== 0) return e2ee;
      if (b.spendableSats !== a.spendableSats) return b.spendableSats - a.spendableSats;
      const live = Number(b.status === 'online') - Number(a.status === 'online');
      if (live !== 0) return live;
      return a.name.localeCompare(b.name);
    });
  }, [knownProviders, byMint, walletTotal, probed]);
}
