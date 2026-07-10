import type { Manager, PreparedReceiveOperation } from '@cashu/coco-core';
import {
  getDecodedToken,
  getTokenMetadata,
  hasValidDleq,
  type HasKeysetKeys,
  type Proof,
} from '@cashu/cashu-ts';

import { getWallet } from '@/shared/lib/cashu/managerInternals';

type OfflineReceiveDleqFailure =
  | 'empty-proofs'
  | 'missing-keyset'
  | 'missing-amount-key'
  | 'missing-dleq'
  | 'missing-blinding-factor'
  | 'invalid-dleq';

/** A local verification failure. It is deliberately distinct from a mint or
 * network failure so an offline transport never queues forged ecash for retry. */
export class OfflineReceiveDleqError extends Error {
  constructor(
    readonly reason: OfflineReceiveDleqFailure,
    message: string
  ) {
    super(message);
    this.name = 'OfflineReceiveDleqError';
  }
}

function fail(reason: OfflineReceiveDleqFailure, message: string): never {
  throw new OfflineReceiveDleqError(reason, message);
}

/**
 * Require NUT-12 verification for every proof in an offline receive.
 *
 * This is an integration boundary around cashu-ts's supported `hasValidDleq`
 * primitive. Sovran owns the fail-closed policy and error classification;
 * cashu-ts continues to own all curve and DLEQ math.
 */
function requireOfflineReceiveProofsDleq(
  proofs: readonly Proof[],
  keysets: readonly HasKeysetKeys[]
): void {
  if (proofs.length === 0) {
    fail('empty-proofs', 'This token does not contain ecash proofs to verify offline.');
  }

  for (const proof of proofs) {
    const keyset = keysets.find((candidate) => candidate.id === proof.id);
    if (!keyset) {
      fail(
        'missing-keyset',
        'This token cannot be verified offline because its mint keys are not saved.'
      );
    }

    if (!keyset.keys[proof.amount.toString()]) {
      fail(
        'missing-amount-key',
        'This token cannot be verified offline because its amount key is not saved.'
      );
    }

    if (!proof.dleq) {
      fail(
        'missing-dleq',
        'This token does not include offline verification proof. Receive it online instead.'
      );
    }

    if (!proof.dleq.r) {
      fail(
        'missing-blinding-factor',
        'This token is missing the blinding factor needed for offline verification.'
      );
    }

    let valid = false;
    try {
      valid = hasValidDleq(proof, keyset, { require: true });
    } catch {
      valid = false;
    }
    if (!valid) {
      fail('invalid-dleq', 'Offline ecash verification failed. Do not accept this token.');
    }
  }
}

async function getKnownKeysetsForProofs(
  manager: Manager,
  mintUrl: string,
  unit: string,
  proofs: readonly Proof[]
): Promise<HasKeysetKeys[]> {
  const wallet = await getWallet(manager, mintUrl, unit);
  const keysets: HasKeysetKeys[] = [];
  for (const id of new Set(proofs.map((proof) => proof.id))) {
    try {
      keysets.push(wallet.keyChain.getKeyset(id));
    } catch {
      // The policy function below reports a stable, non-sensitive error.
    }
  }
  return keysets;
}

/** Verify the exact normalized proofs Coco persisted on a prepared receive. */
export async function requirePreparedOfflineReceiveDleq(
  manager: Manager,
  operation: Pick<PreparedReceiveOperation, 'inputProofs' | 'mintUrl' | 'unit'>
): Promise<void> {
  const keysets = await getKnownKeysetsForProofs(
    manager,
    operation.mintUrl,
    operation.unit,
    operation.inputProofs
  );
  requireOfflineReceiveProofsDleq(operation.inputProofs, keysets);
}

/** Decode and verify a token before accepting it from an offline transport
 * such as Nut Drop. Cached wallet keysets are used; no crypto is implemented
 * here and no raw proof material is logged. */
export async function requireOfflineTokenDleq(
  manager: Manager,
  token: string,
  mintUrl: string
): Promise<void> {
  const metadata = getTokenMetadata(token);
  const unit = metadata.unit ?? 'sat';
  const wallet = await getWallet(manager, mintUrl, unit);
  const decoded = getDecodedToken(token, wallet.keyChain.getAllKeysetIds());
  const keysets: HasKeysetKeys[] = [];
  for (const id of new Set(decoded.proofs.map((proof) => proof.id))) {
    try {
      keysets.push(wallet.keyChain.getKeyset(id));
    } catch {
      // The policy function below reports a stable, non-sensitive error.
    }
  }
  requireOfflineReceiveProofsDleq(decoded.proofs, keysets);
}
