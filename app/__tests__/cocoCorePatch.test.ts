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
