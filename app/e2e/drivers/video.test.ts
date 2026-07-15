import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  startGraceMs?: number;
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
    startGraceMs: overrides.startGraceMs ?? 0,
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

  it('returns null (never throws) when the recorder dies inside the grace period', async () => {
    const proc = new FakeProc();
    const { rec, warnings } = recorder({ proc, hasOutput: () => false, startGraceMs: 30 });
    proc.exitNow(1);
    expect(await rec.start('t.x')).toBeNull();
    expect(warnings.join(' ')).toContain('recording disabled');
  });

  it('starts despite an output file that stays empty — a static screen writes no frames', async () => {
    // recordVideo produces 0 bytes until the display updates; start must not
    // gate on output size (that gate killed real recordings on live sims).
    const { rec, runDir } = recorder({ hasOutput: () => false, startGraceMs: 0 });
    expect(await rec.start('t.x')).toBe(join(runDir, 't.x', 'video.mp4'));
  });

  it('stops with SIGINT only and reports success when the file finalized', async () => {
    const proc = new FakeProc();
    const { rec } = recorder({ proc });
    await rec.start('t.x');
    expect(await rec.stop()).toBe(true);
    expect(proc.signals).toEqual(['SIGINT']);
  });

  it('falls back to SIGKILL, discards the corpse, and reports failure on a hung SIGINT', async () => {
    const proc = new FakeProc(false);
    const { rec, runDir, warnings } = recorder({ proc, stopTimeoutMs: 0 });
    const path = await rec.start('t.x');
    writeFileSync(path!, 'partial'); // the unfinalized container simctl leaves behind
    expect(await rec.stop()).toBe(false);
    expect(proc.signals).toEqual(['SIGINT', 'SIGKILL']);
    expect(warnings.join(' ')).toContain('did not finalize');
    expect(existsSync(join(runDir, 't.x', 'video.mp4'))).toBe(false);
  });

  it('reports failure and discards the file when stop finds no recorded frames', async () => {
    const proc = new FakeProc();
    const { rec, runDir } = recorder({ proc, hasOutput: () => false });
    const path = await rec.start('t.x');
    writeFileSync(path!, ''); // 0-byte file: recorder never saw a display update
    expect(await rec.stop()).toBe(false);
    expect(existsSync(join(runDir, 't.x', 'video.mp4'))).toBe(false);
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
