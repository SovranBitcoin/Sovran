/**
 * @jest-environment node
 */

/**
 * The wallet core ships as its maintainers published it, with one exception.
 *
 * It used to carry a patch that let a P2PK send be reclaimed with a refund
 * key. Upstream says such a send cannot be reclaimed, the patch had never run
 * against a mint, and code that swaps proofs inside the wallet core is not
 * something to carry on our own word. The app now withholds what the core
 * cannot do (`wallet/src/p2pk/reclaimGate.ts`) instead of changing the core.
 *
 * The exception is ADR 0019: `ops.send.prepare({ offline: true })`, which
 * prepares an exact-match send from stored mint data without contacting the
 * mint. The patch is the compiled output of the coco commit kept in
 * `app/patches/sources/`; see `app/patches/README.coco-offline-send.md`.
 *
 * This fails if any other patch arrives, or if that one reaches further.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

// The package's exports map hides its files from `require.resolve`, and the
// workspace hoists it, so look in both places the installer may have put it.
const CANDIDATES = [
  resolve(__dirname, '..', 'node_modules', '@cashu', 'coco-core', 'dist', 'index.js'),
  resolve(__dirname, '..', '..', 'node_modules', '@cashu', 'coco-core', 'dist', 'index.js'),
];
const bundlePath = CANDIDATES.find((candidate) => existsSync(candidate));
const bundle = bundlePath ? readFileSync(bundlePath, 'utf8') : '';

const OFFLINE_SEND_PATCH = '@cashu+coco-core+2.0.0.patch';
const PATCHES_DIR = resolve(__dirname, '..', 'patches');

describe('@cashu/coco-core carries one patch', () => {
  it('found the installed bundle to check', () => {
    expect(bundlePath).toBeTruthy();
  });

  it('has only the offline-send patch registered against a coco package', () => {
    const root = JSON.parse(
      readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as { patchedDependencies?: Record<string, string> };
    const patched = Object.entries(root.patchedDependencies ?? {}).filter(([name]) =>
      name.startsWith('@cashu/coco-')
    );
    expect(patched).toEqual([['@cashu/coco-core@2.0.0', `app/patches/${OFFLINE_SEND_PATCH}`]]);
  });

  it('has no other coco patch file waiting to be registered', () => {
    const files = readdirSync(PATCHES_DIR).filter(
      (name) => /coco/i.test(name) && /\.patch$/.test(name)
    );
    expect(files).toEqual([OFFLINE_SEND_PATCH]);
  });

  it('changes the bundle and its type declarations, nothing else', () => {
    const patch = readFileSync(resolve(PATCHES_DIR, OFFLINE_SEND_PATCH), 'utf8');
    const files = patch
      .split('\n')
      .filter((line) => line.startsWith('diff --git '))
      .map((line) => line.split(' b/')[1]);
    expect(files).toEqual(['dist/index-CvKNFBXJ.d.ts', 'dist/index.d.ts', 'dist/index.js']);
  });

  it('carries the offline prepare option and refuses what needs a swap', () => {
    expect(bundle).toContain(
      'return this.sendOperationService.prepare(initOp, { offline: input.offline });'
    );
    expect(bundle).toContain('async getOfflineWallet(mintUrl, unit) {');
    expect(bundle).toContain('Offline send needs proofs that add up to exactly');
    expect(bundle).toContain('requires the mint and cannot be prepared offline');
  });

  it('keeps the online path refreshing stale mint data', () => {
    expect(bundle).toContain(
      'const { mint, keysets } = await this.mintService.ensureUpdatedMint(normalizedMintUrl);'
    );
  });

  it('carries none of the reclaim code the earlier patch added', () => {
    expect(bundle).not.toContain('collectSigningKeys');
    expect(bundle).not.toContain('assertReclaimable');
    expect(bundle).not.toContain('getP2PKExpectedWitnessPubkeys');
    expect(bundle).not.toContain('no key held that may spend it yet');
  });
});

/**
 * What the app's gate relies on: the core refuses, and leaves the send alone.
 *
 * The refusal has to come before the operation is recorded as rolling back,
 * because nothing writes `pending` back afterwards — a send left in
 * `rolling_back` is one `finalize` skips when the recipient claims it.
 */
describe('@cashu/coco-core and a P2PK send that has left', () => {
  const MINT = 'https://mint.example';
  const OPERATION = 'send-locked';
  const SECRET = JSON.stringify([
    'P2PK',
    { nonce: '00'.repeat(32), data: `02${'ab'.repeat(32)}`, tags: [] },
  ]);

  async function walletWithPendingLockedSend() {
    const { initializeCoco, MemoryRepositories } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the real, installed bundle
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

  it('refuses to reclaim it and leaves it pending', async () => {
    const manager = await walletWithPendingLockedSend();

    await expect(manager.ops.send.reclaim(OPERATION)).rejects.toThrow(
      'Cannot rollback pending P2PK send operation'
    );
    expect((await manager.ops.send.get(OPERATION))?.state).toBe('pending');
  });
});
