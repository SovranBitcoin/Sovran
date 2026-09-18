import type { Proof } from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';
import type { RebalanceWalletPort } from 'wallet';

import { releaseTrustWindow } from '@/features/mint/components/rebalance';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { prepareBolt11MeltQuote, prepareBolt11MintQuote } from '@/shared/lib/cashu/cocoOperations';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { getReadyProofs, getWallet } from '@/shared/lib/cashu/managerInternals';

/**
 * The wallet capabilities the rebalance engine drives, bound to one Coco
 * manager. Each method is a single Coco call or existing recovery helper;
 * sequencing, retries and reconciliation live in `wallet`'s rebalance engine.
 */
export function createRebalanceWalletPort(manager: Manager, unit: string): RebalanceWalletPort {
  return {
    async balancesByMint() {
      const balances = await manager.wallet.balances.byMint();
      return Object.fromEntries(
        Object.entries(balances).map(([mintUrl, balance]) => [
          mintUrl,
          amountToNumber(balance?.total),
        ])
      );
    },
    async worstCaseInputFee(mintUrl) {
      const proofs = await getReadyProofs(manager, mintUrl);
      const wallet = await getWallet(manager, mintUrl, 'sat');
      return amountToNumber(wallet.getFeesForProofs(proofs as unknown as Proof[]));
    },
    async probeMeltFeeReserve(mintUrl, invoice) {
      // cashu-ts quote only: an HTTP read with no persistence or events.
      const wallet = await getWallet(manager, mintUrl, 'sat');
      const quote = await wallet.createMeltQuoteBolt11(invoice);
      return amountToNumber(quote.fee_reserve ?? 0);
    },
    createMintReceipt: (mintUrl, amount) => prepareBolt11MintQuote(manager, mintUrl, amount, unit),
    getMintOperation: (operationId) => manager.ops.mint.get(operationId),
    prepareMelt: (mintUrl, invoice) => prepareBolt11MeltQuote(manager, mintUrl, invoice),
    executeMelt: (operationId) => manager.ops.melt.execute(operationId),
    refreshMelt: (operationId) => manager.ops.melt.refresh(operationId),
    getMeltOperation: (operationId) => manager.ops.melt.get(operationId),
    async restoreInflightProofs(mintUrl) {
      await CocoManager.restoreInflightProofsForMint(mintUrl);
    },
    async trustMint(mintUrl) {
      await manager.mint.addMint(mintUrl, { trusted: true });
    },
    releaseTrust: (mintUrls) => releaseTrustWindow(manager, mintUrls),
  };
}
