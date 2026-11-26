import type { Proof } from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';
import type { RebalanceWalletPort } from 'wallet';
import { amountToNumber, requireAmount } from 'wallet/amount';
import { toRealUnit } from 'wallet/units';

import { releaseTrustWindow } from '@/features/mint/components/rebalance';
import { getReadyProofs, getWallet } from '@/shared/lib/cashu/managerInternals';

/**
 * The wallet capabilities the rebalance engine drives, bound to one Coco
 * manager. Single-hop swap preparation, execution, observation and recovery
 * delegate directly to Coco's `manager.ops.mintSwap`.
 */
export function createRebalanceWalletPort(manager: Manager, unit: string): RebalanceWalletPort {
  if (toRealUnit(unit) !== 'sat') throw new Error('Mint swaps require sat balances');

  const filter = { units: ['sat'] };
  return {
    async balancesByMint() {
      const balances = await manager.wallet.balances.byMint(filter);
      return Object.fromEntries(
        Object.entries(balances).map(([mintUrl, balance]) => [
          mintUrl,
          amountToNumber(balance?.total),
        ])
      );
    },
    async worstCaseInputFee(mintUrl) {
      const proofs = await getReadyProofs(manager, mintUrl, filter);
      const wallet = await getWallet(manager, mintUrl, 'sat');
      return requireAmount(wallet.getFeesForProofs(proofs as unknown as Proof[]));
    },
    mintSwap: manager.ops.mintSwap,
    async trustMint(mintUrl) {
      await manager.mint.addMint(mintUrl, { trusted: true });
    },
    releaseTrust: (mintUrls) => releaseTrustWindow(manager, mintUrls),
  };
}
