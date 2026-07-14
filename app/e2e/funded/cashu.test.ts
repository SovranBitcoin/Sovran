import {
  Amount,
  CheckStateEnum,
  createEphemeralCounterSource,
  type CounterSource,
  type Proof,
} from '@cashu/cashu-ts';
import { describe, expect, it, mock } from 'bun:test';

import {
  createCashuTsRecoveryBackend,
  type CashuWalletFactory,
  type CashuWalletPort,
} from './cashu';
import type { DeclaredRecoveryAsset } from './types';

const asset: DeclaredRecoveryAsset = {
  mintUrl: 'https://mint.test',
  unit: 'sat',
  accountIndex: 0,
  maxPrincipal: 100,
};
const seed = new Uint8Array(64).fill(7);
const KEYSET = '009a1f293253e41e';

const proof = (amount: number, secret: string, overrides: Partial<Proof> = {}): Proof => ({
  id: KEYSET,
  amount: Amount.from(amount),
  secret,
  C: `02${'11'.repeat(32)}`,
  ...overrides,
});

function factoryFor(port: CashuWalletPort): CashuWalletFactory {
  return mock(async () => port);
}

describe('Cashu NUT-13 recovery backend', () => {
  it('restores matching-unit keysets, dedupes exact secrets, keeps only confirmed UNSPENT, and preserves the counter high-water', async () => {
    const p1 = proof(40, 'secret-1');
    const p2 = proof(60, 'secret-2');
    const port: CashuWalletPort = {
      listKeysets: mock(async () => [
        { id: KEYSET, unit: 'sat' },
        { id: 'usd-keyset', unit: 'usd' },
      ]),
      batchRestore: mock(async (keysetId) => {
        if (keysetId !== KEYSET) throw new Error('wrong unit restored');
        return { proofs: [p1, p1, p2], lastCounterWithSignature: 7 };
      }),
      checkProofStates: mock(async (proofs) =>
        proofs.map((_proof: Proof, index: number) => ({
          Y: `Y-${index}`,
          state: index === 0 ? CheckStateEnum.UNSPENT : CheckStateEnum.SPENT,
          witness: null,
        }))
      ),
      maxSpendableAfterFees: mock(() => Amount.zero()),
      sendAll: mock(async () => ({ keep: [], send: [] })),
    };
    const counters = createEphemeralCounterSource({ [KEYSET]: 12 });
    const backend = createCashuTsRecoveryBackend({ walletFactory: factoryFor(port) });

    const restored = await backend.restore(asset, seed, counters, {
      gapLimit: 300,
      batchSize: 100,
    });

    expect(restored.totalAmount).toBe(40);
    expect(restored.proofFingerprints).toHaveLength(1);
    expect(port.batchRestore).toHaveBeenCalledWith(KEYSET, 300, 100);
    expect(await counters.snapshot?.()).toEqual({ [KEYSET]: 12 });
  });

  it('advances the next counter past the last signature and never lowers an existing high-water', async () => {
    const restoredProof = proof(10, 'secret-1');
    const port: CashuWalletPort = {
      listKeysets: async () => [{ id: KEYSET, unit: 'sat' }],
      batchRestore: async () => ({ proofs: [restoredProof], lastCounterWithSignature: 7 }),
      checkProofStates: async () => [{ Y: 'Y', state: CheckStateEnum.UNSPENT, witness: null }],
      maxSpendableAfterFees: () => Amount.zero(),
      sendAll: async () => ({ keep: [], send: [] }),
    };
    const backend = createCashuTsRecoveryBackend({ walletFactory: factoryFor(port) });
    const fresh = createEphemeralCounterSource();
    const ahead = createEphemeralCounterSource({ [KEYSET]: 20 });

    await backend.restore(asset, seed, fresh, { gapLimit: 300, batchSize: 100 });
    await backend.restore(asset, seed, ahead, { gapLimit: 300, batchSize: 100 });

    expect(await fresh.snapshot?.()).toEqual({ [KEYSET]: 8 });
    expect(await ahead.snapshot?.()).toEqual({ [KEYSET]: 20 });
  });

  it('fails closed on PENDING, malformed state responses, or conflicting duplicate secrets', async () => {
    const p = proof(10, 'secret-1');
    const cases: { name: string; proofs: Proof[]; states: unknown; error: RegExp }[] = [
      {
        name: 'pending',
        proofs: [p],
        states: [{ Y: 'Y', state: CheckStateEnum.PENDING, witness: null }],
        error: /PENDING/,
      },
      { name: 'malformed', proofs: [p], states: [], error: /state response/ },
      {
        name: 'conflict',
        proofs: [p, proof(20, 'secret-1')],
        states: [],
        error: /duplicate proof secret/,
      },
    ];

    for (const testCase of cases) {
      const port: CashuWalletPort = {
        listKeysets: async () => [{ id: KEYSET, unit: 'sat' }],
        batchRestore: async () => ({
          proofs: testCase.proofs,
          lastCounterWithSignature: 3,
        }),
        checkProofStates: async () => testCase.states as never,
        maxSpendableAfterFees: () => Amount.zero(),
        sendAll: async () => ({ keep: [], send: [] }),
      };
      const backend = createCashuTsRecoveryBackend({ walletFactory: factoryFor(port) });
      expect(
        backend.restore(asset, seed, createEphemeralCounterSource(), {
          gapLimit: 300,
          batchSize: 100,
        })
      ).rejects.toThrow(testCase.error);
    }
  });

  it('uses maxSpendableAfterFees and reserves deterministic send counters above the restored high-water', async () => {
    const restoredProofs = [proof(64, 'secret-1'), proof(36, 'secret-2')];
    const sentProofs = [proof(64, 'send-1'), proof(34, 'send-2')];
    let walletCounters: CounterSource | undefined;
    let sendReservation: { start: number; count: number } | undefined;
    const sendAll = mock(async () => {
      sendReservation = await walletCounters!.reserve(KEYSET, 2);
      return { keep: [], send: sentProofs };
    });
    const port: CashuWalletPort = {
      listKeysets: async () => [{ id: KEYSET, unit: 'sat' }],
      batchRestore: async () => ({ proofs: restoredProofs, lastCounterWithSignature: 9 }),
      checkProofStates: async () =>
        restoredProofs.map((_, index) => ({
          Y: `Y-${index}`,
          state: CheckStateEnum.UNSPENT,
          witness: null,
        })),
      maxSpendableAfterFees: mock(() => Amount.from(98)),
      sendAll,
    };
    const backend = createCashuTsRecoveryBackend({
      walletFactory: mock(async (options) => {
        walletCounters = options.counters;
        return port;
      }),
    });
    const counters = createEphemeralCounterSource();
    const restored = await backend.restore(asset, seed, counters, {
      gapLimit: 300,
      batchSize: 100,
    });

    const prepared = await backend.prepareSendAll(restored);

    expect(sendAll).toHaveBeenCalledWith(Amount.from(98), restoredProofs, {
      includeFees: true,
    });
    expect(sendReservation).toEqual({ start: 10, count: 2 });
    expect(await counters.snapshot?.()).toEqual({ [KEYSET]: 12 });
    expect(prepared).toMatchObject({ restoredAmount: 100, tokenAmount: 98, sendFee: 2 });
    expect(prepared.token.startsWith('cashuB')).toBe(true);
  });

  it('passes controlled P2PK private custody into the Cashu send', async () => {
    const restoredProofs = [proof(10, 'p2pk-secret')];
    const sendAll = mock(async () => ({ keep: [], send: [proof(10, 'send-secret')] }));
    const port: CashuWalletPort = {
      listKeysets: async () => [{ id: KEYSET, unit: 'sat' }],
      batchRestore: async () => ({ proofs: restoredProofs, lastCounterWithSignature: 2 }),
      checkProofStates: async () => [{ Y: 'Y', state: CheckStateEnum.UNSPENT, witness: null }],
      maxSpendableAfterFees: () => Amount.from(10),
      sendAll,
    };
    const backend = createCashuTsRecoveryBackend({ walletFactory: factoryFor(port) });
    const restored = await backend.restore(asset, seed, createEphemeralCounterSource(), {
      gapLimit: 300,
      batchSize: 100,
    });
    const p2pkPrivateKey = '11'.repeat(32);

    await backend.prepareSendAll(restored, { p2pkPrivateKey });

    expect(sendAll).toHaveBeenCalledWith(Amount.from(10), restoredProofs, {
      includeFees: true,
      privkey: p2pkPrivateKey,
    });
  });

  it('inspects a persisted token against its exact mint/unit and reports every NUT-07 state', async () => {
    const tokenProofs = [proof(40, 'unspent'), proof(20, 'pending'), proof(10, 'spent')];
    const port: CashuWalletPort = {
      listKeysets: async () => [{ id: KEYSET, unit: 'sat' }],
      batchRestore: async () => ({ proofs: [], lastCounterWithSignature: undefined }),
      checkProofStates: async () => [
        { Y: 'Y-1', state: CheckStateEnum.UNSPENT, witness: null },
        { Y: 'Y-2', state: CheckStateEnum.PENDING, witness: null },
        { Y: 'Y-3', state: CheckStateEnum.SPENT, witness: null },
      ],
      decodeToken: () => ({ mint: asset.mintUrl, unit: asset.unit, proofs: tokenProofs }),
      maxSpendableAfterFees: () => Amount.zero(),
      sendAll: async () => ({ keep: [], send: [] }),
    };
    const backend = createCashuTsRecoveryBackend({ walletFactory: factoryFor(port) });

    const inspected = await backend.inspectToken(
      asset,
      'cashuBpersisted',
      seed,
      createEphemeralCounterSource()
    );

    expect(inspected).toEqual({
      totalAmount: 70,
      unspentAmount: 40,
      pendingAmount: 20,
      spentAmount: 10,
    });
  });
});
