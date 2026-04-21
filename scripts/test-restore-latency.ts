/**
 * Test script to measure NUT-09 restore latency at different N values
 * across multiple mints.
 *
 * Usage:
 *   npx tsx scripts/test-restore-latency.ts
 */

import { Wallet, Mint } from '@cashu/cashu-ts';
import { randomBytes } from '@noble/hashes/utils.js';

const MINTS = ['https://mint.sovran.money', 'https://mint.minibits.cash/Bitcoin'];
const TEST_VALUES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
const RUNS_PER_N = 3;
const DELAY_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function benchMint(mintUrl: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${mintUrl}`);
  console.log(`${'='.repeat(60)}\n`);

  const seed = randomBytes(32);
  const mint = new Mint(mintUrl);
  const wallet = new Wallet(mint, { unit: 'sat', bip39seed: seed });

  const loadStart = performance.now();
  await wallet.loadMint();
  console.log(`Mint loaded in ${(performance.now() - loadStart).toFixed(0)}ms\n`);

  // Warmup
  await wallet.restore(0, 1);
  await sleep(DELAY_MS);

  console.log(
    `${'N'.padStart(6)}  ${'avg (ms)'.padStart(10)}  ${'min'.padStart(8)}  ${'max'.padStart(8)}  ${'ms/item'.padStart(8)}`
  );
  console.log('-'.repeat(48));

  for (const n of TEST_VALUES) {
    const times: number[] = [];

    for (let run = 0; run < RUNS_PER_N; run++) {
      const start = performance.now();
      await wallet.restore(0, n);
      times.push(performance.now() - start);
      await sleep(DELAY_MS);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const perItem = avg / n;

    console.log(
      `${String(n).padStart(6)}  ${avg.toFixed(0).padStart(10)}  ${min.toFixed(0).padStart(8)}  ${max.toFixed(0).padStart(8)}  ${perItem.toFixed(2).padStart(8)}`
    );
  }
}

async function main() {
  for (const mintUrl of MINTS) {
    await benchMint(mintUrl);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
