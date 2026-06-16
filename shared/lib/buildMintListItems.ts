import type { Mint } from '@cashu/coco-core';
import {
  composeSatoshis,
  type MintAvailability,
  type MintCatalogEntry,
  type MintListItem,
} from '@sovranbitcoin/colada';

import { log } from '@/shared/lib/logger';
import { getMintDisplayName } from '@/shared/lib/url';

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

/**
 * Builds a fully-resolved `MintListItem[]` from trusted mints, their availability,
 * and a pre-fetched catalog (audit / KYM / operator profile data, keyed by
 * mint URL).
 *
 * The Mint Manager owns this path; `colada` has its own equivalent
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
  log.debug('mint.listItems.build.start', {
    trustedMintCount: trustedMints.length,
    availabilityCount: availability.length,
    catalogCount: Object.keys(catalog).length,
    hasOfflineCheck: !!offlineCheck,
    offlineAmount: offlineCheck?.amount,
  });
  const availMap = new Map(availability.map((a) => [a.mintUrl, a]));

  const mintUrls = [
    ...availability.map((a) => a.mintUrl),
    ...trustedMints.filter((m) => !availMap.has(m.mintUrl)).map((m) => m.mintUrl),
  ];

  const items = mintUrls
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
        auditTotalOps: entry.auditTotalOps,
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
  log.info('mint.listItems.build.result', {
    itemCount: items.length,
    availableCount: items.filter((item) => item.status === 'available').length,
    disabledCount: items.filter((item) => item.status !== 'available').length,
    offlineKnownCount: items.filter((item) => item.worksOffline != null).length,
    offlineComposableCount: items.filter((item) => item.worksOffline === true).length,
    items: items.map((item) => ({
      ...mintUrlLogFields(item.mintUrl),
      status: item.status,
      balance: item.balance,
      reasonCode: item.reason?.code,
      isPreferred: item.isPreferred,
      hasCatalog: item.kymScore != null || item.auditScore != null || item.contactFollowers != null,
      worksOffline: item.worksOffline,
    })),
  });
  return items;
}
