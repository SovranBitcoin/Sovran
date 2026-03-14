import type { Mint } from 'coco-cashu-core';
import type { AuditMintResponse } from '@/shared/lib/apiClient';
import type { MintAvailability, MintListItem } from 'coco-payment-ux';
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';
import { useKYMMintStore } from '@/shared/stores/global/kymMintStore';
import { getMintDisplayName, normalizeMintUrlKey } from '@/shared/lib/url';

/**
 * Derives a 0-5 audit score from raw swap data.
 */
export function computeAuditScore(auditData: AuditMintResponse): number | undefined {
  const swaps = auditData.swaps || [];
  if (swaps.length === 0) return undefined;
  const successCount = swaps.reduce((acc, s) => acc + (s.state === 'OK' ? 1 : 0), 0);
  return (successCount / swaps.length) * 5;
}

/**
 * Builds a fully-resolved MintListItem[] from trusted mints and their computed
 * availability. KYM and audit scores are read synchronously from the Zustand cache.
 *
 * Safe to call in any context — all reads are synchronous `getState()` calls.
 */
export function buildMintListItems(
  trustedMints: Mint[],
  availability: MintAvailability[]
): MintListItem[] {
  const kymState = useKYMMintStore.getState();
  const auditState = useAuditMintStore.getState();
  const availMap = new Map(availability.map((a) => [a.mintUrl, a]));

  const mintUrls = [
    ...availability.map((a) => a.mintUrl),
    ...trustedMints.filter((m) => !availMap.has(m.mintUrl)).map((m) => m.mintUrl),
  ];

  return mintUrls
    .map((mintUrl): MintListItem => {
      const mint = trustedMints.find((m) => m.mintUrl === mintUrl);
      const avail = availMap.get(mintUrl);
      const normalizedUrl = normalizeMintUrlKey(mintUrl);
      const kymCached = kymState.getCached(normalizedUrl);
      const auditCached = auditState.getCached(mintUrl);

      return {
        mintUrl,
        displayName: getMintDisplayName(mintUrl, mint?.mintInfo),
        iconUrl: mint?.mintInfo?.icon_url ?? undefined,
        balance: avail?.balance ?? 0,
        unit: 'sat',
        status: avail?.status ?? 'available',
        reason: avail?.reason ?? null,
        isPreferred: avail?.isPreferred ?? false,
        kymScore: kymCached?.score,
        auditScore: auditCached ? computeAuditScore(auditCached.auditData) : undefined,
        auditState: auditCached?.auditData?.state,
      };
    })
    .sort((a, b) => {
      if (a.status === 'available' && b.status !== 'available') return -1;
      if (b.status === 'available' && a.status !== 'available') return 1;
      return b.balance - a.balance;
    });
}
