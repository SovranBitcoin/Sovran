import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutLane } from './workers';

const machine = join(import.meta.dir, 'machine.ts');

// A fresh process must see its lease configuration before importing machine.ts.
// Other suites already import that module, so changing this process's environment
// cannot select a new lease and would accidentally exercise the shared machine lock.
function isolatedLease(code: string, minimumFree = '0') {
  const folder = mkdtempSync(join(tmpdir(), 'sovran-lease-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `import assert from 'node:assert/strict';
        import { readFileSync, writeFileSync, existsSync } from 'node:fs';
        import { spawn } from 'node:child_process';
        import { holdNativeLease } from ${JSON.stringify(machine)};
        const lease = process.env.SOVRAN_NATIVE_LEASE;
        ${code}`,
      ],
      {
        cwd: folder,
        env: {
          ...process.env,
          SOVRAN_NATIVE_LEASE: join(folder, 'lease.json'),
          SOVRAN_NATIVE_MIN_FREE_GB: minimumFree,
          SOVRAN_NATIVE_LEASE_HELD: '',
        },
        encoding: 'utf8',
        timeout: 15_000,
      }
    );
    if (result.error) throw result.error;
    return result;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test('two checkouts of one folder name get different simulators', () => {
  expect(checkoutLane('/a/sovran-app')).not.toBe(checkoutLane('/b/sovran-app'));
  expect(checkoutLane('/a/sovran-app')).toMatch(/^sovran-app-[0-9a-f]{6}$/);
});

test('a second native run waits until the first has finished', () => {
  const first = `import {holdNativeLease} from ${JSON.stringify(machine)};
    const deadline = setTimeout(() => process.exit(2), 10000);
    const release = await holdNativeLease('first');
    try { console.log('held'); await new Promise(resolve => setTimeout(resolve,1500)); }
    finally { release(); clearTimeout(deadline); }`;
  const result = isolatedLease(`
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(first)}], {
      env: {...process.env, SOVRAN_NATIVE_LEASE_HELD: ''}, stdio: ['ignore','pipe','inherit']
    });
    const exited = new Promise((resolve,reject) => {
      child.once('exit', resolve); child.once('error', reject);
    });
    let release;
    try {
      await Promise.race([
        new Promise(resolve => child.stdout.once('data', resolve)),
        exited.then(() => { throw new Error('First holder exited before readiness'); })
      ]);
      const asked = performance.now();
      release = await holdNativeLease('second');
      assert.ok(performance.now()-asked > 1000, 'Second holder must wait for the first');
      assert.equal(JSON.parse(readFileSync(lease,'utf8')).what,'second');
      assert.equal(await exited, 0);
    } finally {
      release?.();
      if (child.exitCode === null) child.kill('SIGTERM');
      await exited;
    }
  `);
  expect(result.status, result.stderr).toBe(0);
}, 20_000);

test('a lease whose holder has gone is taken at once', () => {
  const result = isolatedLease(`
    writeFileSync(lease, JSON.stringify({pid:999999, what:'gone', checkout:'/', since:''}));
    const asked = performance.now();
    const release = await holdNativeLease('third');
    try {
      assert.ok(performance.now()-asked < 1000, 'Dead holder must not delay acquisition');
      assert.ok(existsSync(lease));
      assert.equal(JSON.parse(readFileSync(lease,'utf8')).what, 'third');
    } finally { release(); }
  `);
  expect(result.status, result.stderr).toBe(0);
});

test('native work refuses to start on a nearly full disk', () => {
  const result = isolatedLease("await holdNativeLease('too big');", '100000');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('machine.ts reclaim');
});
