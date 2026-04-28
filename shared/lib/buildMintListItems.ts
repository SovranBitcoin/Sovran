import type { Mint } from '@cashu/coco-core';
import {
  composeSatoshis,
  type MintAvailability,
  type MintCatalogEntry,
  type MintListItem,
} from 'coco-payment-ux';

import { getMintDisplayName } from '@/shared/lib/url';

/**
 * Builds a fully-resolved `MintListItem[]` from trusted mints, their availability,
 * and a pre-fetched catalog (audit / KYM / operator profile data, keyed by
 * mint URL).
 *
 * The Mint Manager owns this path; `coco-payment-ux` has its own equivalent
 * for Send / Receive Select Mint that pulls the same catalog via the
 * `fetchMintCatalog` callback. Both surfaces consume identical fields, so the
 * audit / score pills render the same regardless of entry point.
 */
export function buildMintListItems(
  trustedMints: Mint[],
  availability: MintAvailability[],
  catalog: Record<string, MintCatalogEntry> = {},
  offlineCheck?: { amount: number; proofAmounts: Record<string, number[]> }
): MintListItem[] {
  const availMap = new Map(availability.map((a) => [a.mintUrl, a]));

  const mintUrls = [
    ...availability.map((a) => a.mintUrl),
    ...trustedMints.filter((m) => !availMap.has(m.mintUrl)).map((m) => m.mintUrl),
  ];

  return mintUrls
    .map((mintUrl): MintListItem => {
      const mint = trustedMints.find((m) => m.mintUrl === mintUrl);
      const avail = availMap.get(mintUrl);
      const entry = catalog[mintUrl] ?? {};

      const proofs = offlineCheck?.proofAmounts[mintUrl];
      const worksOffline =
        offlineCheck && proofs && proofs.length > 0
          ? composeSatoshis(proofs, offlineCheck.amount).exactMatch
          : undefined;

      return {
        mintUrl,
        displayName: getMintDisplayName(mintUrl, mint?.mintInfo),
        iconUrl: mint?.mintInfo?.icon_url ?? undefined,
        balance: avail?.balance ?? 0,
        unit: 'sat',
        status: avail?.status ?? 'available',
        reason: avail?.reason ?? null,
        isPreferred: avail?.isPreferred ?? false,
        kymScore: entry.kymScore,
        reviewCount: entry.reviewCount,
        auditScore: entry.auditScore,
        auditState: entry.auditState,
        contactFollowers: entry.contactFollowers,
        contactReputation: entry.contactReputation,
        worksOffline,
      };
    })
    .sort((a, b) => {
      if (a.status === 'available' && b.status !== 'available') return -1;
      if (b.status === 'available' && a.status !== 'available') return 1;
      return b.balance - a.balance;
    });
}
