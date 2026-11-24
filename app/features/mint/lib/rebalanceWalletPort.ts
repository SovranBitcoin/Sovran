import type { Proof } from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';
import {
  createEngineSingleLegTransferPort,
  createRebalanceEngine,
  type createRebalanceLock,
  type RebalanceWalletPort,
  type SingleLegTransferPort,
} from 'wallet';
import { amountToNumber, requireAmount } from 'wallet/amount';

import { releaseTrustWindow } from '@/features/mint/components/rebalance';
import { prepareBolt11MeltQuote, prepareMintQuote } from '@/shared/lib/cashu/cocoOperations';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { getReadyProofs, getWallet } from '@/shared/lib/cashu/managerInternals';
import { cashuLog } from '@/shared/lib/logger';

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
      return requireAmount(wallet.getFeesForProofs(proofs as unknown as Proof[]));
    },
    async probeMeltFeeReserve(mintUrl, invoice) {
      // cashu-ts quote only: an HTTP read with no persistence or events.
      const wallet = await getWallet(manager, mintUrl, 'sat');
      const quote = await wallet.createMeltQuoteBolt11(invoice);
      return requireAmount(quote.fee_reserve);
    },
    createMintReceipt: (mintUrl, amount) =>
      prepareMintQuote(manager, 'bolt11', mintUrl, amount, unit),
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

/**
 * The single-leg transfer seam (ADR 0037) on Coco 2.0.0: one mint-to-mint
 * transfer per call, run by the rebalance engine's one-leg path over this
 * manager, with the shape Coco v3's `manager.ops.mintSwap` will have. The
 * quote and melt it is made of stay inside; callers see the leg id only.
 *
 * `lock` is the screen's rebalance lock, so a leg never overlaps a plan run.
 * Adopting Coco v3 replaces this function's body with `manager.ops.mintSwap`.
 */
export function createCocoSingleLegTransferPort(
  manager: Manager,
  unit: string,
  options: {
    lock: ReturnType<typeof createRebalanceLock>;
    trustedMintUrls: ReadonlySet<string>;
    minTransferThreshold: number;
    minFeeReserve: number;
  }
): SingleLegTransferPort {
  const wallet = createRebalanceWalletPort(manager, unit);
  const engine = createRebalanceEngine({
    wallet,
    // A single leg is never routed through middlemen: the caller routes.
    findRoutes: async () => [],
    trustedMintUrls: options.trustedMintUrls,
    minTransferThreshold: options.minTransferThreshold,
    minFeeReserve: options.minFeeReserve,
    lock: options.lock,
    logger: cashuLog,
  });
  return createEngineSingleLegTransferPort({ engine, wallet, unit });
}
