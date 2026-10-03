/**
 * @jest-environment node
 */

import type { Manager } from '@cashu/coco-core';

import {
  isAlreadyRecoveredError,
  isRestorableKeysetId,
  restoreKeysetForMint,
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

describe('restoreKeysetForMint', () => {
  it('passes the cached wallet to Coco without patching it', async () => {
    const wallet = Object.freeze({});
    const restoreKeyset = jest.fn(async () => undefined);
    const getWallet = jest.fn(async () => wallet);
    const manager = {
      walletService: { getWallet },
      walletRestoreService: { restoreKeyset },
    } as unknown as Manager;

    await restoreKeysetForMint(manager, {
      mintUrl: 'https://mint.example',
      keysetId: '009a1f293253e41e',
      unit: 'sat',
    });

    expect(getWallet).toHaveBeenCalledWith('https://mint.example', 'sat');
    expect(restoreKeyset).toHaveBeenCalledWith(
      'https://mint.example',
      wallet,
      '009a1f293253e41e',
      'sat'
    );
  });
});
