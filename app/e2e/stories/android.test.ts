import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindAndroidStoryApp, requireFreshAndroidStory } from './android';
import { storySchema } from './story';

test('an installed APK mismatch prevents writing a runner note or opening its channel', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'android-story-binding-'));
  const apk = join(outDir, 'built.apk');
  writeFileSync(apk, 'the expected APK');
  const note = { run: 'current-run', url: 'ws://127.0.0.1:40123' };
  let connections = 0;
  const writes: string[] = [];
  const writeRunnerNote = async (delivered: typeof note) => {
    connections++;
    writes.push(JSON.stringify(delivered));
  };
  const adb = {
    shell: async (args: string[]) => {
      if (args[0] === 'pm') return 'package:/data/app/owned/base.apk';
      writes.push(args.join(' '));
      return JSON.stringify(note);
    },
    raw: async (args: string[]) => {
      writeFileSync(args[2], 'a stale APK');
      return '';
    },
  };
  try {
    await expect(bindAndroidStoryApp({ adb, apk, outDir, note, writeRunnerNote })).rejects.toThrow(
      'differs'
    );
    expect(connections).toBe(0);
    expect(writes).toEqual([]);
    const receipt = JSON.parse(readFileSync(join(outDir, 'payload.json'), 'utf8'));
    expect(receipt.built).not.toBe(receipt.installed);
    adb.raw = async (args) => {
      writeFileSync(args[2], readFileSync(apk));
      return '';
    };
    const matching = await bindAndroidStoryApp({ adb, apk, outDir, note, writeRunnerNote });
    expect(matching.installed).toBe(matching.built);
    expect(connections).toBe(1);
    expect(writes).toEqual([JSON.stringify(note)]);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('Android preflight rejects unsupported setup without allocating infrastructure', () => {
  const fresh = {
    id: 'test-story',
    purpose: 'A person sees their first page on a fresh device.',
    startsFrom: 'fresh',
    steps: [{ name: 'first page', expect: [{ page: 'LegalDocumentScreen' }] }],
  };
  requireFreshAndroidStory(storySchema.parse(fresh));
  for (const unsupported of [
    { startsFrom: 'funded-wallet' },
    { given: { invoice: { mint: 'local', sats: 10 } } },
    { allow: ['camera'] },
  ]) {
    expect(() => requireFreshAndroidStory(storySchema.parse({ ...fresh, ...unsupported }))).toThrow(
      'require fresh state'
    );
  }
});
