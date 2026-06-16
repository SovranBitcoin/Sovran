// ---------------------------------------------------------------------------
// Manager internals — typed seam (sovran-app)
// ---------------------------------------------------------------------------
//
// coco-core's `Manager` exposes a curated public API (`mint`, `wallet`,
// `history`, `ops`, …) but several wallet flows still need access to fields
// that the public surface marks `private`: `proofService`, `walletService`,
// `meltOperationRepository`, and `mintOperationRepository`. Without a seam,
// each caller writes its own `(manager as unknown as { … })` cast, and a
// future coco rename silently breaks all of them.
//
// This module is the deep adapter for those reach-ins. Every cast is
// collapsed into one place behind a small typed interface. Callers depend on
// the helper signatures — not on the cast — so a coco internals change trips
// the type-checker here (one file) instead of breaking N callers at runtime.
//
// Lives in sovran-app rather than colada because every caller is
// sovran-side (cashu-manager bootstrap, recovery screen, rebalance plan,
// transactions hooks, wallet context provider). colada's own
// internals stay inside that package.
//
// When coco promotes any of these to its public API, delete the corresponding
// helper and migrate callers to the official accessor. Until then, this file
// is the only sanctioned place to reach past the `private` boundary.
//
// Historical trigger: repeated TS2341/private-reach-in failures across mint-op
// cleanup, migration, and reserved-proof paths. Keep future reach-ins here.
// See `../.agents/skills/sovran-architecture-workflow`.

import type { CoreProof, Manager } from '@cashu/coco-core';
import type { Wallet } from '@cashu/cashu-ts';
import { cashuLog } from '@/shared/lib/logger';

interface ManagerInternals {
  proofRepository: {
    getReservedProofs(): Promise<CoreProof[]>;
    getInflightProofs(mintUrls?: string[]): Promise<CoreProof[]>;
  };
  proofService: {
    getReadyProofs(mintUrl: string): Promise<CoreProof[]>;
    saveProofs(mintUrl: string, proofs: CoreProof[]): Promise<void>;
    restoreProofsToReady(mintUrl: string, secrets: string[]): Promise<void>;
  };
  walletService: {
    getWallet(mintUrl: string): Promise<Wallet>;
  };
  counterService: {
    overwriteCounter(
      mintUrl: string,
      keysetId: string,
      counter: number
    ): Promise<{ mintUrl: string; keysetId: string; counter: number }>;
  };
  mintOperationRepository: {
    delete(id: string): Promise<void>;
  };
}

function internals(manager: Manager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

/** Ready (UNSPENT, unreserved) proofs for one mint, via the private ProofService. */
export async function getReadyProofs(manager: Manager, mintUrl: string): Promise<CoreProof[]> {
  cashuLog.debug('cashu.manager_internals.ready_proofs.start', {
    ...mintUrlLogFields(mintUrl),
  });
  try {
    const proofs = await internals(manager).proofService.getReadyProofs(mintUrl);
    cashuLog.debug('cashu.manager_internals.ready_proofs.done', {
      ...mintUrlLogFields(mintUrl),
      count: proofs.length,
    });
    return proofs;
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.ready_proofs.failed', {
      ...mintUrlLogFields(mintUrl),
      error: errorMessage(error),
    });
    throw error;
  }
}

/** Wallet for one mint, via the private WalletService. */
export async function getWallet(manager: Manager, mintUrl: string): Promise<Wallet> {
  cashuLog.debug('cashu.manager_internals.wallet.start', { ...mintUrlLogFields(mintUrl) });
  try {
    const wallet = await internals(manager).walletService.getWallet(mintUrl);
    cashuLog.debug('cashu.manager_internals.wallet.done', { ...mintUrlLogFields(mintUrl) });
    return wallet;
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.wallet.failed', {
      ...mintUrlLogFields(mintUrl),
      error: errorMessage(error),
    });
    throw error;
  }
}

/** All proofs reserved by an in-flight operation (have `usedByOperationId`). */
export async function getReservedProofs(manager: Manager): Promise<CoreProof[]> {
  cashuLog.debug('cashu.manager_internals.reserved_proofs.start');
  try {
    const proofs = await internals(manager).proofRepository.getReservedProofs();
    cashuLog.debug('cashu.manager_internals.reserved_proofs.done', { count: proofs.length });
    return proofs;
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.reserved_proofs.failed', {
      error: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Inflight proofs (transient state during mint/melt), optionally filtered by mint.
 * Used by the per-mint rebalance recovery to clear leftovers after a melt failure.
 */
export async function getInflightProofs(
  manager: Manager,
  mintUrls?: string[]
): Promise<CoreProof[]> {
  cashuLog.debug('cashu.manager_internals.inflight_proofs.start', {
    mintCount: mintUrls?.length ?? null,
  });
  try {
    const proofs = await internals(manager).proofRepository.getInflightProofs(mintUrls);
    cashuLog.debug('cashu.manager_internals.inflight_proofs.done', {
      mintCount: mintUrls?.length ?? null,
      count: proofs.length,
    });
    return proofs;
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.inflight_proofs.failed', {
      mintCount: mintUrls?.length ?? null,
      error: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Move proofs from `inflight` back to `ready` and clear their operation tag.
 * Application-level equivalent of the "Restore Inflight" debug button.
 */
export async function restoreProofsToReady(
  manager: Manager,
  mintUrl: string,
  secrets: string[]
): Promise<void> {
  cashuLog.info('cashu.manager_internals.restore_proofs.start', {
    ...mintUrlLogFields(mintUrl),
    count: secrets.length,
  });
  try {
    await internals(manager).proofService.restoreProofsToReady(mintUrl, secrets);
    cashuLog.info('cashu.manager_internals.restore_proofs.done', {
      ...mintUrlLogFields(mintUrl),
      count: secrets.length,
    });
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.restore_proofs.failed', {
      ...mintUrlLogFields(mintUrl),
      count: secrets.length,
      error: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Persist proofs in the given mint+state, via the private ProofService.
 * Used by the legacy Redux→Coco migration to seed the proof table.
 */
export async function saveProofs(
  manager: Manager,
  mintUrl: string,
  proofs: CoreProof[]
): Promise<void> {
  cashuLog.info('cashu.manager_internals.save_proofs.start', {
    ...mintUrlLogFields(mintUrl),
    count: proofs.length,
  });
  try {
    await internals(manager).proofService.saveProofs(mintUrl, proofs);
    cashuLog.info('cashu.manager_internals.save_proofs.done', {
      ...mintUrlLogFields(mintUrl),
      count: proofs.length,
    });
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.save_proofs.failed', {
      ...mintUrlLogFields(mintUrl),
      count: proofs.length,
      error: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Force-set a deterministic counter for a (mint, keyset) pair, via the private
 * CounterService. Used by the legacy Redux→Coco migration to recover counters
 * the user already burnt before installing the Coco-backed build.
 */
export async function overwriteCounter(
  manager: Manager,
  mintUrl: string,
  keysetId: string,
  counter: number
): Promise<{ mintUrl: string; keysetId: string; counter: number }> {
  cashuLog.info('cashu.manager_internals.counter_overwrite.start', {
    ...mintUrlLogFields(mintUrl),
    keysetId,
    counter,
  });
  try {
    const result = await internals(manager).counterService.overwriteCounter(
      mintUrl,
      keysetId,
      counter
    );
    cashuLog.info('cashu.manager_internals.counter_overwrite.done', {
      ...mintUrlLogFields(mintUrl),
      keysetId,
      counter: result.counter,
    });
    return result;
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.counter_overwrite.failed', {
      ...mintUrlLogFields(mintUrl),
      keysetId,
      counter,
      error: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Drop one mint operation, via the private MintOperationRepository.
 *
 * Used by recovery flows to abandon mint ops whose deterministic outputs were
 * generated against a stale counter (NPC-sync race) and would loop forever.
 * Coco does not yet expose a public abandon API; revisit when it does.
 */
export async function deleteMintOperation(manager: Manager, id: string): Promise<void> {
  cashuLog.info('cashu.manager_internals.mint_operation_delete.start', { id });
  try {
    await internals(manager).mintOperationRepository.delete(id);
    cashuLog.info('cashu.manager_internals.mint_operation_delete.done', { id });
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.mint_operation_delete.failed', {
      id,
      error: errorMessage(error),
    });
    throw error;
  }
}
