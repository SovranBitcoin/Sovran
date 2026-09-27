/**
 * @jest-environment node
 */

/**
 * app/patches/README.md: a successful install is not proof the patch landed.
 *
 * This patch is the difference between "you can take this back after Friday"
 * being true and being a lie the wallet tells while the money is already gone,
 * so a coco bump that silently drops it has to fail here rather than on a
 * device, months later, at the moment someone tries to reclaim.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// The package's exports map hides its files from `require.resolve`, and the
// workspace hoists it, so look in both places the installer may have put it.
const CANDIDATES = [
  resolve(__dirname, '..', 'node_modules', '@cashu', 'coco-core', 'dist', 'index.js'),
  resolve(__dirname, '..', '..', 'node_modules', '@cashu', 'coco-core', 'dist', 'index.js'),
];
const bundlePath = CANDIDATES.find((candidate) => existsSync(candidate));
const bundle = bundlePath ? readFileSync(bundlePath, 'utf8') : '';

describe('@cashu/coco-core patch — reclaiming a P2PK send', () => {
  it('found the installed bundle to check', () => {
    expect(bundlePath).toBeTruthy();
  });

  it('asks cashu-ts which keys may spend a proof right now', () => {
    // Not "which key is it locked to": after a locktime passes the refund
    // keys may spend it too, and that timing IS the feature.
    expect(bundle).toContain('getP2PKExpectedWitnessPubkeys');
  });

  it('hands the signing keys to the reclaim swap', () => {
    expect(bundle).toMatch(/privkey:\s*privkeys/);
  });

  it('no longer refuses every pending P2PK rollback outright', () => {
    expect(bundle).not.toContain('Cannot rollback pending P2PK send operation');
  });

  it('refuses a reclaim it cannot sign instead of letting the mint reject it', () => {
    // The operation must stay pending so the recipient can still claim.
    expect(bundle).toContain('no key held that may spend it yet');
  });

  it('gives the P2PK handler the keyring it signs with', () => {
    expect(bundle).toContain('new P2pkSendHandler(this.outputDataCreator, keyRingService)');
  });
});

/**
 * What the strings above cannot show: that a refusal leaves the operation
 * alone. The service records `rolling_back` before it calls the handler and
 * nothing writes `pending` back when the handler throws, so a refusal raised
 * inside `rollback` stranded the send in a state `reclaim` rejects and
 * `finalize` skips — a timed lock cancelled early could never be taken back.
 */
describe('@cashu/coco-core patch — a reclaim nothing here can sign', () => {
  const MINT = 'https://mint.example';
  const OPERATION = 'send-locked';
  // Locked to a key this wallet does not hold.
  const SECRET = JSON.stringify([
    'P2PK',
    { nonce: '00'.repeat(32), data: `02${'ab'.repeat(32)}`, tags: [] },
  ]);

  async function walletWithPendingLockedSend() {
    const { initializeCoco, MemoryRepositories } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the real, patched bundle
      require('@cashu/coco-core') as typeof import('@cashu/coco-core');
    const repo = new MemoryRepositories();
    const manager = await initializeCoco({
      repo,
      seedGetter: async () => new Uint8Array(64).fill(1),
      watchers: {
        mintOperationWatcher: { disabled: true },
        proofStateWatcher: { disabled: true },
        meltQuoteWatcher: { disabled: true },
      },
      processors: {
        mintOperationProcessor: { disabled: true },
        meltSettlementProcessor: { disabled: true },
      },
    });
    const now = Date.now();
    // Rows as the wallet's own repositories hold them, written directly: the
    // send that produced them would need a mint.
    const lockedProof = {
      id: '00ad268c4d1f5826',
      amount: 8,
      secret: SECRET,
      C: `02${'cd'.repeat(32)}`,
      mintUrl: MINT,
      unit: 'sat',
      state: 'inflight',
      usedByOperationId: OPERATION,
    };
    const pendingSend = {
      id: OPERATION,
      state: 'pending',
      mintUrl: MINT,
      amount: 8,
      unit: 'sat',
      method: 'p2pk',
      methodData: { pubkey: `02${'ab'.repeat(32)}` },
      needsSwap: false,
      fee: 0,
      inputAmount: 8,
      inputProofSecrets: [SECRET],
      createdAt: now,
      updatedAt: now,
    };
    type Proofs = Parameters<typeof repo.proofRepository.saveProofs>[1];
    type Send = Parameters<typeof repo.sendOperationRepository.create>[0];
    await repo.proofRepository.saveProofs(MINT, [lockedProof] as unknown as Proofs);
    await repo.sendOperationRepository.create(pendingSend as unknown as Send);
    return manager;
  }

  it('is refused with the operation still pending, and can be asked again', async () => {
    const manager = await walletWithPendingLockedSend();

    await expect(manager.ops.send.reclaim(OPERATION)).rejects.toThrow(
      'no key held that may spend it yet'
    );
    expect((await manager.ops.send.get(OPERATION))?.state).toBe('pending');

    // The second ask is the one that matters: it is the reclaim after the
    // lock opens, and it has to reach the key check rather than be turned
    // away for the state the first one left behind.
    await expect(manager.ops.send.reclaim(OPERATION)).rejects.toThrow(
      'no key held that may spend it yet'
    );
    expect((await manager.ops.send.get(OPERATION))?.state).toBe('pending');
  });
});
