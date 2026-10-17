import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutLane } from './workers';

const folder = mkdtempSync(join(tmpdir(), 'sovran-lease-'));
const lease = join(folder, 'lease.json');
process.env.SOVRAN_NATIVE_LEASE = lease;
process.env.SOVRAN_NATIVE_MIN_FREE_GB = '0';
const { holdNativeLease } = await import('./machine');

test('two checkouts of one folder name get different simulators', () => {
  expect(checkoutLane('/a/sovran-app')).not.toBe(checkoutLane('/b/sovran-app'));
  expect(checkoutLane('/a/sovran-app')).toMatch(/^sovran-app-[0-9a-f]{6}$/);
});

test('a second native run waits until the first has finished', async () => {
  const child = spawn(
    'bun',
    [
      '-e',
      `const { holdNativeLease } = await import(${JSON.stringify(join(import.meta.dir, 'machine.ts'))});
       await holdNativeLease('first');
       console.log('held');
       await new Promise((resolve) => setTimeout(resolve, 1500));`,
    ],
    { env: { ...process.env, SOVRAN_NATIVE_LEASE_HELD: '' }, stdio: ['ignore', 'pipe', 'inherit'] }
  );
  await new Promise<void>((resolve) => child.stdout.on('data', () => resolve()));
  const asked = performance.now();
  await holdNativeLease('second');
  expect(performance.now() - asked).toBeGreaterThan(1000);
  expect(JSON.parse(readFileSync(lease, 'utf8')).what).toBe('second');
}, 20_000);

test('a lease whose holder has gone is taken at once', async () => {
  delete process.env.SOVRAN_NATIVE_LEASE_HELD;
  writeFileSync(lease, JSON.stringify({ pid: 999_999, what: 'gone', checkout: '/', since: '' }));
  const asked = performance.now();
  await holdNativeLease('third');
  expect(performance.now() - asked).toBeLessThan(1000);
  expect(existsSync(lease)).toBe(true);
});

test('native work refuses to start on a nearly full disk', async () => {
  delete process.env.SOVRAN_NATIVE_LEASE_HELD;
  const child = spawn(
    'bun',
    [
      '-e',
      `const { holdNativeLease } = await import(${JSON.stringify(join(import.meta.dir, 'machine.ts'))});
       await holdNativeLease('too big');`,
    ],
    {
      env: {
        ...process.env,
        SOVRAN_NATIVE_LEASE: join(folder, 'other.json'),
        SOVRAN_NATIVE_MIN_FREE_GB: '100000',
        SOVRAN_NATIVE_LEASE_HELD: '',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let said = '';
  child.stderr.on('data', (chunk) => (said += String(chunk)));
  const code = await new Promise((resolve) => child.on('exit', resolve));
  expect(code).not.toBe(0);
  expect(said).toContain('machine.ts reclaim');
});
