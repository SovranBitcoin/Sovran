// ---------------------------------------------------------------------------
// Manager internals — typed seam
// ---------------------------------------------------------------------------
//
// coco-core's `Manager` exposes a curated public API (`mint`, `wallet`,
// `history`, `ops`, …) but several wallet flows still need access to fields
// that the public surface marks `private`: `proofService`, `walletService`,
// `meltOperationRepository`, and `mintOperationRepository`. Without a seam,
// each caller writes its own `(manager as unknown as { … })` cast, and a
// future coco rename silently breaks all of them.
//
// This module is a deep adapter: every reach-in is collapsed into one place
// behind a small typed interface. Callers depend on the helper signatures —
// not on the cast — so a coco internals change trips the type-checker here
// (one file) instead of breaking N callers at runtime.
//
// When coco promotes any of these to its public API, delete the corresponding
// helper and migrate callers to the official accessor. Until then, this file
// is the only sanctioned place to reach past the `private` boundary.
//
// Refs:
//   - sovran-app/__audits__/24.json#F-003 (pending-mint-op cleanup cast)
//   - sovran-app/__audits__/36.json#F-008 (8 TS2341 errors on Manager)
//

import type {
  CoreProof,
  Manager,
  MeltOperation,
  MeltOperationState,
} from '@cashu/coco-core';
import type { Wallet } from '@cashu/cashu-ts';

interface ManagerInternals {
  proofService: {
    getReadyProofs(mintUrl: string): Promise<CoreProof[]>;
  };
  walletService: {
    getWallet(mintUrl: string): Promise<Wallet>;
  };
  meltOperationRepository: {
    getByState(state: MeltOperationState): Promise<MeltOperation[]>;
  };
  mintOperationRepository: {
    delete(id: string): Promise<void>;
  };
}

function internals(manager: Manager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

/** Ready (UNSPENT, unreserved) proofs for one mint, via the private ProofService. */
export function getReadyProofs(manager: Manager, mintUrl: string): Promise<CoreProof[]> {
  return internals(manager).proofService.getReadyProofs(mintUrl);
}

/** Wallet for one mint, via the private WalletService. */
export function getWallet(manager: Manager, mintUrl: string): Promise<Wallet> {
  return internals(manager).walletService.getWallet(mintUrl);
}

/**
 * Melt operations in a given state, via the private MeltOperationRepository.
 *
 * The `prepareMeltBolt11`/`executeMelt` flow stores operations here but does
 * not emit `melt-quote:created`, so the public history is incomplete — this
 * is the seam history-merge code uses to bridge the gap.
 */
export function listMeltOperationsByState(
  manager: Manager,
  state: MeltOperationState
): Promise<MeltOperation[]> {
  return internals(manager).meltOperationRepository.getByState(state);
}

/**
 * Drop one mint operation, via the private MintOperationRepository.
 *
 * Used by recovery flows to abandon mint ops whose deterministic outputs were
 * generated against a stale counter (NPC-sync race) and would loop forever.
 * Coco does not yet expose a public abandon API; revisit when it does.
 */
export function deleteMintOperation(manager: Manager, id: string): Promise<void> {
  return internals(manager).mintOperationRepository.delete(id);
}
