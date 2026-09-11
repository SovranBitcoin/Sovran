import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseByteRange, serveRunFile } from './files';
import { ARTIFACTS } from './paths';

// <video> playback depends on correct 206 semantics: Safari refuses to play
// without range support, Chrome needs it to seek. Bad parses must fall back to
// a full-body 200 (undefined), never a wrong slice.
describe('parseByteRange', () => {
  test('parses explicit, open-ended, and suffix ranges', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=200-', 1000)).toEqual({ start: 200, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  test('clamps an end past the file size', () => {
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  test('falls back to full-body for multi-range, inverted, or malformed headers', () => {
    expect(parseByteRange('bytes=0-1,5-9', 1000)).toBeUndefined();
    expect(parseByteRange('bytes=500-100', 1000)).toBeUndefined();
    expect(parseByteRange('bytes=-', 1000)).toBeUndefined();
    expect(parseByteRange('octets=0-1', 1000)).toBeUndefined();
    expect(parseByteRange('bytes=2000-', 1000)).toBeUndefined();
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const makeRun = () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const root = mkdtempSync(join(ARTIFACTS, 'run-store-download-test-'));
  roots.push(root);
  return root;
};

describe('store archive downloads', () => {
  test('serves each generated store ZIP as a downloadable archive', async () => {
    const root = makeRun();
    mkdirSync(join(root, 'store'));
    const bytes = Buffer.from('PK store archive');
    for (const name of [
      'screenshots',
      'app-store',
      'freedom-store',
      'website',
      'google-play',
      'zapstore',
      'github-apk',
    ]) {
      writeFileSync(join(root, 'store', `${name}.zip`), bytes);
      const response = serveRunFile(basename(root), `store/${name}.zip`, true);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/zip');
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${name}.zip"`
      );
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
  });

  test('keeps arbitrary archives and custody files private', () => {
    const root = makeRun();
    for (const path of [
      'backup.zip',
      'store/backup.zip',
      'custody/app-store.zip',
      'store/custody/app-store.zip',
    ]) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), 'private');
      expect(serveRunFile(basename(root), path, true).status).toBe(403);
    }
  });

  test('rejects archives reached through a symlinked store directory', () => {
    const root = makeRun();
    const external = mkdtempSync(join(tmpdir(), 'sovran-store-private-test-'));
    roots.push(external);
    writeFileSync(join(external, 'app-store.zip'), 'private');
    symlinkSync(external, join(root, 'store'));
    expect(serveRunFile(basename(root), 'store/app-store.zip', true).status).toBe(403);
  });
});
