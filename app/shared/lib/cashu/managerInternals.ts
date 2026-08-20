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
// See `skills/sovran-architecture`.

import type { CoreProof, Manager } from '@cashu/coco-core';
import type { Wallet } from '@cashu/cashu-ts';
import { cashuLog, mintUrlLogFields } from '@/shared/lib/logger';

interface ManagerInternals {
  proofRepository: {
    getReservedProofs(): Promise<CoreProof[]>;
    getInflightProofs(mintUrls?: string[]): Promise<CoreProof[]>;
  };
  proofService: {
    getReadyProofs(mintUrl: string): Promise<CoreProof[]>;
    setProofState(
      mintUrl: string,
      secrets: string[],
      state: 'inflight' | 'ready' | 'spent'
    ): Promise<void>;
    restoreProofsToReady(mintUrl: string, secrets: string[]): Promise<void>;
  };
  walletService: {
    getWallet(mintUrl: string, unit: string): Promise<Wallet>;
  };
  walletRestoreService: {
    restoreKeyset(mintUrl: string, wallet: Wallet, keysetId: string, unit?: string): Promise<void>;
  };
  mintOperationRepository: {
    delete(id: string): Promise<void>;
  };
  mintService: {
    keysetRepo: {
      getKeysetsByMintUrl(
        mintUrl: string
      ): Promise<{ unit?: string; keypairs?: Record<string, unknown> }[]>;
    };
  };
}

function internals(manager: Manager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Units a mint actually holds keysets (with keys) for, via the private
 * keyset repository — local DB read, no network. Mirrors coco's own
 * WalletService validKeysets filter: a mint can only issue units it has
 * keypairs for, regardless of what NUT-04/05 advertises.
 */
export async function getMintKeysetUnits(manager: Manager, mintUrl: string): Promise<string[]> {
  cashuLog.debug('cashu.manager_internals.keyset_units.start', {
    ...mintUrlLogFields(mintUrl),
  });
  try {
    const keysets = await internals(manager).mintService.keysetRepo.getKeysetsByMintUrl(mintUrl);
    const units = new Set<string>();
    for (const keyset of keysets) {
      if (!keyset.keypairs || Object.keys(keyset.keypairs).length === 0) continue;
      units.add((keyset.unit || 'sat').toLowerCase());
    }
    const result = [...units];
    cashuLog.debug('cashu.manager_internals.keyset_units.done', {
      ...mintUrlLogFields(mintUrl),
      keysetCount: keysets.length,
      units: result.join(','),
    });
    return result;
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.keyset_units.failed', {
      ...mintUrlLogFields(mintUrl),
      error: errorMessage(error),
    });
    throw error;
  }
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

/** Mark only mint-proven spent proofs through ProofService so Coco emits its
 * normal `proofs:state-changed` event and every balance consumer refreshes. */
export async function markProofsSpent(
  manager: Manager,
  mintUrl: string,
  secrets: string[]
): Promise<void> {
  if (secrets.length === 0) return;
  cashuLog.info('cashu.manager_internals.mark_spent.start', {
    ...mintUrlLogFields(mintUrl),
    count: secrets.length,
  });
  try {
    await internals(manager).proofService.setProofState(mintUrl, secrets, 'spent');
    cashuLog.info('cashu.manager_internals.mark_spent.done', {
      ...mintUrlLogFields(mintUrl),
      count: secrets.length,
    });
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.mark_spent.failed', {
      ...mintUrlLogFields(mintUrl),
      count: secrets.length,
      error: errorMessage(error),
    });
    throw error;
  }
}

/** Wallet for one mint+unit, via the private WalletService (v2 caches per (mint, unit)). */
export async function getWallet(manager: Manager, mintUrl: string, unit: string): Promise<Wallet> {
  cashuLog.debug('cashu.manager_internals.wallet.start', { ...mintUrlLogFields(mintUrl), unit });
  try {
    const wallet = await internals(manager).walletService.getWallet(mintUrl, unit);
    cashuLog.debug('cashu.manager_internals.wallet.done', { ...mintUrlLogFields(mintUrl), unit });
    return wallet;
  } catch (error) {
    cashuLog.warn('cashu.manager_internals.wallet.failed', {
      ...mintUrlLogFields(mintUrl),
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

/**
 * NUT-02 keyset ids are hex: 16 chars (v1) or 66 chars (v2, version-byte
 * prefixed). Mints do serve ids outside that — `mint.minibits.cash` advertises
 * legacy ids like `9mlfd5vCzgGl` — and the two implementations disagree about
 * them: cashu-ts feeds the string straight into NUT-13 derivation and returns
 * garbage, while the native CDK creator parses it as a real `Id` and throws
 * `invalid keyset id` (rust/src/lib.rs `parse_keyset_id`). Neither can restore
 * anything useful, so screen these out before they can fail a healthy mint.
 */
export function isRestorableKeysetId(keysetId: string): boolean {
  return /^[0-9a-fA-F]{16}$|^[0-9a-fA-F]{66}$/.test(keysetId);
}

/**
 * Whether a keyset restore failed only because the proofs were already in the
 * database.
 *
 * coco's `saveProofs` SELECTs each secret and throws `Proof with secret already
 * exists` if any row is present, so re-running recovery on a wallet that has
 * already recovered fails EVERY keyset that holds proofs. That is a benign,
 * fully-expected outcome being reported as failure — recovery is meant to be
 * safe to run twice. Classify it so the UI can say "already recovered".
 *
 * Matches on the message because coco raises a bare `Error` for the inner cause
 * and wraps it in `ProofOperationError`; there is no error code to key off.
 */
export function isAlreadyRecoveredError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes('Proof with secret already exists') ||
    message.includes('Failed to persist proofs')
  );
}

/**
 * Restore ONE keyset, via the private WalletRestoreService.
 *
 * This is the body of coco's own `WalletApi.restore` loop (get the wallet for
 * the keyset's unit, then `restoreKeyset`). The recovery screen drives that
 * loop itself because `wallet.restore(mintUrl)` is `Promise<void>` that walks
 * every keyset silently and throws once at the end: it can report neither
 * "keyset 3 of 8" nor *which* keyset failed. On a real wallet one mint can
 * hold the UI for over a minute, so per-keyset granularity is the difference
 * between a progress display and a bare spinner.
 *
 * Keep in step with coco's loop if it changes — `restoreKeysetForMint.test.ts`
 * pins the call shape, and the cast lives in one place so a coco rename trips
 * the type-checker here rather than at runtime.
 */
export interface ProofStateTally {
  /** Proofs the mint reported UNSPENT — the only ones coco keeps. */
  ready: number;
  /** Proofs unblinded at full cost and then discarded as already spent. */
  spent: number;
}

export async function restoreKeysetForMint(
  manager: Manager,
  mintUrl: string,
  keysetId: string,
  unit: string,
  /**
   * Accumulated into, NOT returned.
   *
   * The keysets worth measuring are exactly the ones that throw: a keyset whose
   * proofs are already in the database reaches `checkProofsStates`, gets its
   * full verdict, and only then fails in `saveProofs` with "Proof with secret
   * already exists". A return value is discarded on that path, which is why the
   * first version of this reported `proofsReady: 0, proofsSpent: 0` on a run
   * where coco's own logs showed 75 ready and 445 spent. Writing through a
   * caller-owned object keeps the counts whatever the restore does next.
   */
  tally?: ProofStateTally
): Promise<void> {
  const wallet = await internals(manager).walletService.getWallet(mintUrl, unit);

  // Count the NUT-07 verdict on the way past.
  //
  // This is the number that reframes recovery cost: a restore unblinds every
  // signature the mint returns — the single most expensive operation in the
  // wallet — and only then asks which are still unspent. On a used wallet the
  // answer is "almost none", so the great majority of that work is discarded.
  // coco logs the split per keyset but returns void, and without it in the
  // benchmark the run summary can only say how many proofs were unblinded, not
  // how many were worth unblinding.
  //
  // An own property shadowing the prototype method, deleted in `finally`: the
  // wallet is cached per (mintUrl, unit) by WalletService, so this instance
  // outlives the restore and must be handed back unpatched.
  const patched = wallet as Omit<Wallet, 'checkProofsStates'> & {
    checkProofsStates?: Wallet['checkProofsStates'];
  };
  const original = wallet.checkProofsStates.bind(wallet);
  patched.checkProofsStates = async (proofs) => {
    const states = await original(proofs);
    if (tally) {
      for (const state of states) {
        if (state.state === 'SPENT') tally.spent += 1;
        else tally.ready += 1;
      }
    }
    return states;
  };
  try {
    await internals(manager).walletRestoreService.restoreKeyset(mintUrl, wallet, keysetId, unit);
  } finally {
    delete patched.checkProofsStates;
  }
}

/** Counters scanned by a shallow probe before declaring a mint unused. */
const PROBE_COUNTER_WINDOW = 100;

/**
 * Does this seed have ANY history at this mint?
 *
 * "Search all mints" probes up to 100 unknown mints, and a full restore of each
 * — a 300-counter gap walk over every keyset — is wildly disproportionate when
 * the answer for nearly all of them is "nothing here". This asks the cheapest
 * question instead: one batch at counter 0 per keyset. An unused mint answers
 * with zero signatures, which costs one round trip and NO unblinding, because
 * `toProof` only runs for outputs the mint actually signed — and that is the
 * overwhelmingly common case, which is what makes the probe worth having.
 *
 * A mint that DOES have history is the expensive case: `Wallet.restore` unblinds
 * every signature inline before returning, so a hit pays for up to
 * `PROBE_COUNTER_WINDOW` proofs and then discards them, and the real restore
 * re-derives them from counter 0 anyway. Bounded and rare (only "Search all
 * mints" reaches here, and only for mints the user has actually used), but it is
 * the reason `PROBE_CONCURRENCY` is small: four hit-mints unblinding at once
 * rebuilds exactly the microtask pile-up the sequential redesign removed.
 * Avoiding it needs `Mint.restore` without the unblind step, which means
 * building the outputs from the seed here rather than through `Wallet`.
 *
 * Read-only: `Wallet.restore` returns proofs without persisting. Only mints
 * that answer yes go on to a real restore.
 */
export async function probeMintForHistory(manager: Manager, mintUrl: string): Promise<boolean> {
  const { keysets } = await manager.mint.addMint(mintUrl, { trusted: true });
  for (const keyset of keysets) {
    if (!isRestorableKeysetId(keyset.id)) continue;
    const unit = (keyset.unit ?? 'sat').toLowerCase();
    const wallet = await internals(manager).walletService.getWallet(mintUrl, unit);
    const { proofs } = await wallet.restore(0, PROBE_COUNTER_WINDOW, { keysetId: keyset.id });
    if (proofs.length > 0) {
      cashuLog.info('cashu.manager_internals.probe.hit', {
        ...mintUrlLogFields(mintUrl),
        keysetId: keyset.id,
        proofs: proofs.length,
      });
      return true;
    }
  }
  return false;
}
