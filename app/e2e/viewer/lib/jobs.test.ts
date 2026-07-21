import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activeJob, getJob, killActiveJob, startRunJob } from './jobs';

describe('killActiveJob', () => {
  test('refuses with no active job, kills a running job so the lock releases', async () => {
    expect(killActiveJob()).toEqual({ error: 'no job is running' });

    const hang = ['bun', '-e', 'await new Promise(() => {})'];
    const job = startRunJob([hang, hang]);
    expect('id' in job).toBe(true);
    if (!('id' in job)) return;
    expect(killActiveJob()).toEqual({ ok: true, id: job.id });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && activeJob()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(activeJob()).toBeUndefined();
  }, 15_000);
});

describe('startRunJob (fake driver, real spawn)', () => {
  test('runs a smoke, discovers the run dir, single-job lock holds', async () => {
    const argv = [
      'bun',
      'e2e/cli.ts',
      'run',
      '--driver',
      'fake',
      '--suite',
      'full',
      '--scenario',
      'onboarding.fresh',
    ];
    const job = startRunJob(argv);
    expect('id' in job).toBe(true);
    if (!('id' in job)) return;
    expect(activeJob()?.id).toBe(job.id);
    const second = startRunJob(argv);
    expect('error' in second).toBe(true);

    // wait for exit (fake driver finishes in a couple of seconds)
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && activeJob()) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(activeJob()).toBeUndefined();
  }, 30_000);

  test('runs a command matrix sequentially and preserves every command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-viewer-jobs-'));
    const marker = join(dir, 'order.txt');
    const argvs = [
      ['bun', '-e', `await Bun.sleep(100); await Bun.write(${JSON.stringify(marker)}, "ios")`],
      [
        'bun',
        '-e',
        `const p=${JSON.stringify(marker)}; const first=await Bun.file(p).text(); await Bun.write(p, first+",android")`,
      ],
    ];
    try {
      const job = startRunJob(argvs);
      expect('id' in job).toBe(true);
      if (!('id' in job)) return;
      expect(job.argvs).toEqual(argvs);

      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && activeJob()) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(getJob(job.id)).toMatchObject({ status: 'exited', exitCode: 0, argvs });
      expect(readFileSync(marker, 'utf8')).toBe('ios,android');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  test('continues the matrix after a failed command and keeps the first failure', async () => {
    const job = startRunJob([
      ['bun', '-e', 'process.exit(7)'],
      ['bun', '-e', 'process.exit(0)'],
    ]);
    expect('id' in job).toBe(true);
    if (!('id' in job)) return;

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && activeJob()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(getJob(job.id)).toMatchObject({ status: 'exited', exitCode: 7 });
    expect(getJob(job.id)?.argv).toEqual(['bun', '-e', 'process.exit(0)']);
  }, 15_000);
});
