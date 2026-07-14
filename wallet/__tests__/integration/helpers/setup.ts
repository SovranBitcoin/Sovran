import { initializeCoco, MemoryRepositories } from '@cashu/coco-core';
import type { Manager } from '@cashu/coco-core';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The live-lane mint. Refuses to default to a public production mint (the old
 * `|| 'https://mint.minibits.cash/Bitcoin'` fallback silently networked every
 * offline run). A live run must point at a local fakewallet/regtest mint via
 * TEST_MINT_URL. Any non-loopback mint needs SOVRAN_ALLOW_PUBLIC_MINT=1 so a
 * misspelled or newly introduced public host cannot silently spend real funds.
 */
export function requireLiveMint(): string {
  const url = process.env.TEST_MINT_URL;
  if (!url) {
    throw new Error(
      'integration lane requires an explicit TEST_MINT_URL (a local fakewallet/regtest mint); ' +
        'refusing to default to a public production mint.'
    );
  }
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    host = parsed.hostname;
  } catch {
    throw new Error('integration lane requires an absolute HTTP(S) TEST_MINT_URL');
  }
  if (!LOOPBACK_HOSTS.has(host) && process.env.SOVRAN_ALLOW_PUBLIC_MINT !== '1') {
    throw new Error(
      `refusing to run integration tests against non-loopback host ${host}; ` +
        'use a local fakewallet mint, or set SOVRAN_ALLOW_PUBLIC_MINT=1 for a deliberate live smoke.'
    );
  }
  return url;
}

// Only the three live-mint test files import this helper; vitest.config.ts
// excludes those files from the default gate while retaining the deterministic
// in-memory integration contracts.
export const TEST_MINT = requireLiveMint();

const TEST_SEED = new Uint8Array(64).fill(1);

export async function createTestManager(): Promise<Manager> {
  const repos = new MemoryRepositories();
  await repos.init();

  return initializeCoco({
    repo: repos,
    seedGetter: async () => TEST_SEED,
    watchers: {
      mintOperationWatcher: { disabled: true },
      proofStateWatcher: { disabled: true },
    },
    processors: {
      mintOperationProcessor: { disabled: true },
    },
  });
}

export async function addTrustedMint(manager: Manager, mintUrl: string) {
  const isTrusted = await manager.mint.isTrustedMint(mintUrl);
  if (!isTrusted) {
    await manager.mint.addMint(mintUrl, { trusted: true });
  }
}

/**
 * Fund the wallet from the live mint. Throws on failure — a broken funded path
 * must be a RED test in the live lane, never a silent green (the old version
 * swallowed every error and returned false, letting funded tests `return` early
 * with zero assertions).
 */
export async function fundWallet(manager: Manager, mintUrl: string, amount: number): Promise<void> {
  await addTrustedMint(manager, mintUrl);
  const quote = await manager.quotes.mint.create({
    mintUrl,
    amount,
    method: 'bolt11',
  });
  const mintOp = await manager.ops.mint.prepare({
    mintUrl,
    method: 'bolt11',
    quoteId: quote.quoteId,
  });
  await manager.ops.mint.execute(mintOp.id);
}
