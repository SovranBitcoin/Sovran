import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalMint } from './localMint';

const installed = spawnSync('cdk-mintd', ['--version']).status === 0;

interface Quote {
  quote: string;
  state: string;
}

/* eslint-disable no-restricted-globals -- the test's own mint on loopback, outside the app */
async function quotePaid(mintUrl: string): Promise<boolean> {
  const asked = await fetch(`${mintUrl}/v1/mint/quote/bolt11`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 100, unit: 'sat' }),
  });
  const { quote } = (await asked.json()) as Quote;
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const now = (await (await fetch(`${mintUrl}/v1/mint/quote/bolt11/${quote}`)).json()) as Quote;
    if (now.state === 'PAID') return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}
/* eslint-enable no-restricted-globals */

describe.skipIf(!installed)('a private mint for a worker', () => {
  test('two mints run side by side and each marks its own invoice paid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sovran-e2e-mint-'));
    const mints = await Promise.all([
      startLocalMint(join(dir, 'a'), 34_191),
      startLocalMint(join(dir, 'b'), 34_192),
    ]);
    try {
      expect(mints.map((mint) => mint.url)).toEqual([
        'http://127.0.0.1:34191',
        'http://127.0.0.1:34192',
      ]);
      expect(await Promise.all(mints.map((mint) => quotePaid(mint.url)))).toEqual([true, true]);
    } finally {
      for (const mint of mints) mint.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a mint that cannot have its port says so instead of hanging', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sovran-e2e-mint-'));
    const first = await startLocalMint(join(dir, 'a'), 34_193);
    try {
      await expect(startLocalMint(join(dir, 'b'), 34_193)).rejects.toThrow(/local mint/);
    } finally {
      first.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
