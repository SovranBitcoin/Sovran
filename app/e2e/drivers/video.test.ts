import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSimVideoRecorder, type RecorderProcess } from './video';

class FakeProc implements RecorderProcess {
  signals: (number | NodeJS.Signals)[] = [];
  #resolve!: (code: number) => void;
  readonly exited = new Promise<number>((resolve) => {
    this.#resolve = resolve;
  });
  constructor(private readonly finalizesOnSigint = true) {}
  kill(signal: number | NodeJS.Signals = 'SIGTERM'): void {
    this.signals.push(signal);
    if (signal === 'SIGKILL' || (signal === 'SIGINT' && this.finalizesOnSigint)) this.#resolve(0);
  }
  exitNow(code = 1): void {
    this.#resolve(code);
  }
}

function recorder(overrides: {
  proc?: FakeProc | (() => FakeProc);
  hasOutput?: (path: string) => boolean;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
}) {
  const runDir = mkdtempSync(join(tmpdir(), 'e2e-video-'));
  const spawned: { argv: string[]; proc: FakeProc }[] = [];
  const warnings: string[] = [];
  const rec = createSimVideoRecorder({
    udid: 'UDID-TEST',
    runDir,
    spawn: (argv) => {
      const proc =
        typeof overrides.proc === 'function'
          ? overrides.proc()
          : (overrides.proc ?? new FakeProc());
      spawned.push({ argv, proc });
      return proc;
    },
    hasOutput: overrides.hasOutput ?? (() => true),
    sleep: async () => {},
    onWarning: (message) => warnings.push(message),
    startTimeoutMs: overrides.startTimeoutMs ?? 3000,
    stopTimeoutMs: overrides.stopTimeoutMs ?? 10_000,
  });
  return { rec, runDir, spawned, warnings };
}

describe('createSimVideoRecorder', () => {
  it('spawns the pinned recordVideo command and resolves the scenario video path', async () => {
    const { rec, runDir, spawned } = recorder({});
    const path = await rec.start('mint.add.url');
    expect(path).toBe(join(runDir, 'mint.add.url', 'video.mp4'));
    expect(spawned[0].argv).toEqual([
      'xcrun',
      'simctl',
      'io',
      'UDID-TEST',
      'recordVideo',
      '--codec',
      'h264',
      '--force',
      join(runDir, 'mint.add.url', 'video.mp4'),
    ]);
  });

  it('returns null (never throws) when the recorder exits before producing output', async () => {
    const proc = new FakeProc();
    const { rec, spawned, warnings } = recorder({ proc, hasOutput: () => false });
    proc.exitNow(1);
    expect(await rec.start('t.x')).toBeNull();
    expect(spawned[0].proc.signals).toContain('SIGKILL');
    expect(warnings.join(' ')).toContain('recording disabled');
  });

  it('returns null when no output appears within the start budget', async () => {
    const { rec, spawned, warnings } = recorder({ hasOutput: () => false, startTimeoutMs: 0 });
    expect(await rec.start('t.x')).toBeNull();
    expect(spawned[0].proc.signals).toContain('SIGKILL');
    expect(warnings.join(' ')).toContain('no output');
  });

  it('stops with SIGINT only and reports success when the file finalized', async () => {
    const proc = new FakeProc();
    const { rec } = recorder({ proc });
    await rec.start('t.x');
    expect(await rec.stop()).toBe(true);
    expect(proc.signals).toEqual(['SIGINT']);
  });

  it('falls back to SIGKILL and reports failure when SIGINT never finalizes', async () => {
    const proc = new FakeProc(false);
    const { rec, warnings } = recorder({ proc, stopTimeoutMs: 0 });
    await rec.start('t.x');
    expect(await rec.stop()).toBe(false);
    expect(proc.signals).toEqual(['SIGINT', 'SIGKILL']);
    expect(warnings.join(' ')).toContain('did not finalize');
  });

  it('reports failure when the recorder exits without leaving a file behind', async () => {
    const proc = new FakeProc();
    let started = false;
    const { rec } = recorder({ proc, hasOutput: () => !started });
    await rec.start('t.x');
    started = true; // file vanished (or was never flushed) by stop time
    expect(await rec.stop()).toBe(false);
  });

  it('stop and dispose are safe no-ops without an active recording', async () => {
    const { rec } = recorder({});
    expect(await rec.stop()).toBe(false);
    await rec.dispose(); // must not throw
  });

  it('dispose finalizes a still-active recording', async () => {
    const proc = new FakeProc();
    const { rec } = recorder({ proc });
    await rec.start('t.x');
    await rec.dispose();
    expect(proc.signals).toEqual(['SIGINT']);
  });
});
