/**
 * @jest-environment node
 */

import type { Manager } from '@cashu/coco-core';

import {
  isAlreadyRecoveredError,
  isRestorableKeysetId,
  restoreKeysetForMint,
  type ProofStateTally,
} from '@/shared/lib/cashu/managerInternals';

jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('isRestorableKeysetId', () => {
  it.each([
    // v1: 16 hex chars, as served by mint.sovran.money and minibits.
    ['00988fbe749ca4d1', true],
    ['00107937db0cc865', true],
    // v2: 66 hex chars, version-byte prefixed — ldk.thesimplekid.dev.
    ['01fb5c0e707d1a26e1ea8e8a70f6117beecc22b4797ac3548e802ec7ee477ec627', true],
    // Real legacy ids minibits still advertises. The native CDK creator throws
    // `invalid keyset id` on these; cashu-ts silently derives nonsense.
    ['9mlfd5vCzgGl', false],
    ['ctv28hTYzQwr', false],
    // Wrong lengths and non-hex.
    ['00988fbe749ca4d', false],
    ['00988fbe749ca4d1a', false],
    ['00988fbe749ca4dz', false],
    ['', false],
  ] as const)('%s -> %s', (keysetId, expected) => {
    expect(isRestorableKeysetId(keysetId)).toBe(expected);
  });

  it('accepts either hex case', () => {
    expect(isRestorableKeysetId('00988FBE749CA4D1')).toBe(true);
  });
});

describe('isAlreadyRecoveredError', () => {
  it('recognises the duplicate-secret error coco raises on a second run', () => {
    expect(
      isAlreadyRecoveredError(
        new Error('Proof with secret already exists: 038a8dbbaa1708e089010535253e335a')
      )
    ).toBe(true);
  });

  it('recognises the ProofOperationError wrapper when every cause is a duplicate', () => {
    const wrapper = new Error('Failed to persist proofs for 1 keyset group(s) [00988f]', {
      cause: new AggregateError(
        [new Error('Proof with secret already exists: 038a8dbb')],
        'Failed to persist proofs for 1 keyset group(s)'
      ),
    });
    expect(isAlreadyRecoveredError(wrapper)).toBe(true);
  });

  it('does NOT treat a persist failure as already-recovered', () => {
    // coco wraps every saveProofs rejection in the same message. Misreading a
    // real write failure as benign reports "Recovery Complete" for a restore
    // that saved nothing, and permanently clears the restore gate.
    const diskFull = new Error('Failed to persist proofs for 1 keyset group(s) [00988f]', {
      cause: new AggregateError(
        [new Error('SQLITE_FULL: database or disk is full')],
        'Failed to persist proofs for 1 keyset group(s)'
      ),
    });
    expect(isAlreadyRecoveredError(diskFull)).toBe(false);

    const mixed = new Error('Failed to persist proofs for 2 keyset group(s) [00988f, 00ad12]', {
      cause: new AggregateError(
        [
          new Error('Proof with secret already exists: 038a8dbb'),
          new Error('SQLITE_BUSY: database is locked'),
        ],
        'Failed to persist proofs for 2 keyset group(s)'
      ),
    });
    expect(isAlreadyRecoveredError(mixed)).toBe(false);

    // No readable cause at all — stays a failure rather than passing blind.
    expect(
      isAlreadyRecoveredError(new Error('Failed to persist proofs for 1 keyset group(s) [00988f]'))
    ).toBe(false);
  });

  it('does not swallow a real restore failure', () => {
    expect(isAlreadyRecoveredError(new Error('Network request failed'))).toBe(false);
    expect(isAlreadyRecoveredError(new Error('Restored less proofs than expected.'))).toBe(false);
    expect(
      isAlreadyRecoveredError(
        new Error('OutputDataCreator.createDeterministicData(...): invalid keyset id')
      )
    ).toBe(false);
  });

  it('tolerates non-Error throws', () => {
    expect(isAlreadyRecoveredError('Proof with secret already exists: abc')).toBe(true);
    expect(isAlreadyRecoveredError(undefined)).toBe(false);
  });
});

describe('restoreKeysetForMint proof-state tally', () => {
  const STATES = [{ state: 'SPENT' }, { state: 'UNSPENT' }, { state: 'SPENT' }, { state: 'SPENT' }];

  /**
   * A wallet whose `checkProofsStates` lives on the prototype, matching cashu-ts
   * — the tally shadows it with an own property and must put it back.
   */
  class FakeWallet {
    async checkProofsStates() {
      return STATES;
    }
  }

  function fakeManager(restoreKeyset: () => Promise<void>) {
    const wallet = new FakeWallet();
    return {
      wallet,
      manager: {
        walletService: { getWallet: async () => wallet },
        walletRestoreService: { restoreKeyset },
      } as unknown as Manager,
    };
  }

  it('counts the spent/unspent split', async () => {
    const tally: ProofStateTally = { ready: 0, spent: 0 };
    const { manager, wallet } = fakeManager(async () => {
      await wallet.checkProofsStates();
    });

    await restoreKeysetForMint(manager, 'https://mint.example', '009a1f293253e41e', 'sat', tally);

    expect(tally).toEqual({ ready: 1, spent: 3 });
  });

  it('keeps the counts when the restore throws afterwards', async () => {
    // The regression. A keyset that already holds its proofs gets a full
    // verdict from `checkProofsStates` and THEN fails in `saveProofs`, so a
    // returned value is discarded exactly where the numbers matter — which is
    // how a run reported 0 ready / 0 spent while coco logged 75 and 445.
    const tally: ProofStateTally = { ready: 0, spent: 0 };
    const { manager, wallet } = fakeManager(async () => {
      await wallet.checkProofsStates();
      throw new Error('Proof with secret already exists: 038a8dbb');
    });

    await expect(
      restoreKeysetForMint(manager, 'https://mint.example', '009a1f293253e41e', 'sat', tally)
    ).rejects.toThrow('already exists');

    expect(tally).toEqual({ ready: 1, spent: 3 });
  });

  it('accumulates across keysets and leaves the cached wallet unpatched', async () => {
    const tally: ProofStateTally = { ready: 0, spent: 0 };
    const { manager, wallet } = fakeManager(async () => {
      await wallet.checkProofsStates();
    });

    await restoreKeysetForMint(manager, 'https://mint.example', '009a1f293253e41e', 'sat', tally);
    await restoreKeysetForMint(manager, 'https://mint.example', '00107937db0cc865', 'sat', tally);

    expect(tally).toEqual({ ready: 2, spent: 6 });
    // WalletService caches per (mintUrl, unit), so the instrumented method must
    // not outlive the restore — a leaked wrapper would double-count forever.
    expect(Object.hasOwn(wallet, 'checkProofsStates')).toBe(false);
  });
});
