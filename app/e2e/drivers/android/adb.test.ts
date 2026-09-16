import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Adb, ADB_COMMAND_TIMEOUT_MS, extractUiautomatorXml } from './adb';

describe('extractUiautomatorXml', () => {
  it('extracts the XML tree without a trailing status line', () => {
    expect(extractUiautomatorXml('noise\n<?xml version="1.0"?><hierarchy />\nUI dumped')).toBe(
      '<?xml version="1.0"?><hierarchy />'
    );
  });

  it('never embeds malformed raw AX output in its error', () => {
    const rawPrivateOutput = 'raw-private-ax-output';

    expect(() => extractUiautomatorXml(rawPrivateOutput)).toThrow(
      `dump produced no XML (${rawPrivateOutput.length} bytes)`
    );
    try {
      extractUiautomatorXml(rawPrivateOutput);
    } catch (error) {
      expect(String(error)).not.toContain(rawPrivateOutput);
    }
  });
});

describe('uiautomatorDumpXml retries', () => {
  it('retries a window that was still animating instead of reporting an empty screen', async () => {
    const adb = new Adb({ serial: 'owned-test', bin: 'adb' });
    const outputs = ['', 'ERROR: could not get idle state.', '<?xml version="1.0"?><hierarchy />'];
    let calls = 0;
    // A reaped dump returns no bytes at all; that is "still moving", not "blank".
    (adb as unknown as { execOutBytes: () => Promise<Uint8Array> }).execOutBytes = async () =>
      new TextEncoder().encode(outputs[calls++] ?? '');
    expect(await adb.uiautomatorDumpXml(3)).toBe('<?xml version="1.0"?><hierarchy />');
    expect(calls).toBe(3);
  });

  it('gives up with the last failure rather than an empty tree', async () => {
    const adb = new Adb({ serial: 'owned-test', bin: 'adb' });
    (adb as unknown as { execOutBytes: () => Promise<Uint8Array> }).execOutBytes = async () =>
      new TextEncoder().encode('');
    await expect(adb.uiautomatorDumpXml(2)).rejects.toThrow(/produced no XML/);
  });
});

describe('bounded Android transport', () => {
  let directory: string;
  let bin: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'sovran-adb-timeout-'));
    bin = join(directory, 'adb');
    writeFileSync(bin, '#!/bin/sh\nexec /bin/sleep 60\n', { mode: 0o700 });
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('has a finite default budget and does not swallow a timeout under allowFail', async () => {
    const adb = new Adb({ serial: 'owned-test', bin });
    expect(ADB_COMMAND_TIMEOUT_MS).toBe(30_000);
    await expect(adb.raw([], { timeoutMs: 20, allowFail: true })).rejects.toThrow(/timed out/);
  });

  it('bounds binary exec-out and propagates cancellation without raw output', async () => {
    const adb = new Adb({ serial: 'owned-test', bin });
    await expect(adb.execOutBytes([], 20)).rejects.toThrow(/timed out/);
    const abort = new AbortController();
    const cancelled = new Adb({ serial: 'owned-test', bin, signal: abort.signal });
    const result = cancelled.execOutBytes([], 2_000);
    abort.abort(new Error('session interrupted'));
    await expect(result).rejects.toThrow('session interrupted');
  });

  it('also bounds the remote UIAutomator process, not just its host adb client', async () => {
    class DumpAdb extends Adb {
      args: string[] = [];
      override async execOutBytes(args: string[]) {
        this.args = args;
        return new TextEncoder().encode('<?xml version="1.0"?><hierarchy />');
      }
    }
    const adb = new DumpAdb({ serial: 'owned-test', bin: 'unused' });
    await adb.uiautomatorDumpXml();
    expect(adb.args).toEqual(['timeout', '-k', '2', '20', 'uiautomator', 'dump', '/dev/tty']);
  });
});
