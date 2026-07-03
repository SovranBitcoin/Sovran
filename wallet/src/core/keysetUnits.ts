// ---------------------------------------------------------------------------
// Keyset-units reach-in — the units a mint can actually issue
//
// Reaches past coco's mint service to the persisted keysets for one mint —
// local DB read, no network. A mint can only issue units it holds keys for;
// some mints advertise NUT-04/05 method-units without keysets (coco throws
// "No valid keysets found" on attempt), so unit support must gate on the
// real keyset units, mirroring coco's own WalletService validKeysets filter
// (keypairs present + unit match). Shared by the wallet-context tracker and
// the mint-list builder.
// ---------------------------------------------------------------------------

import type { Manager } from '@cashu/coco-core';

export async function getKeysetUnits(
  manager: Manager,
  mintUrl: string,
): Promise<string[]> {
  const keysets = await (
    manager as unknown as {
      mintService: {
        keysetRepo: {
          getKeysetsByMintUrl(
            mintUrl: string,
          ): Promise<{ unit?: string; keypairs?: Record<string, unknown> }[]>;
        };
      };
    }
  ).mintService.keysetRepo.getKeysetsByMintUrl(mintUrl);
  const units = new Set<string>();
  for (const keyset of keysets) {
    if (!keyset.keypairs || Object.keys(keyset.keypairs).length === 0) continue;
    units.add((keyset.unit || 'sat').toLowerCase());
  }
  return [...units];
}
