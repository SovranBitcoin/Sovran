import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promoteCandidates, recordRefreshFailures, type LibraryPaths } from './promote';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const appSource = { fingerprint: 'd'.repeat(64), gitSha: 'e'.repeat(40), gitDirty: false };
const build = {
  fingerprint: 'a'.repeat(40),
  appVersion: '0.1.3',
  buildNumber: '2',
  gitSha: 'b'.repeat(40),
  builtAt: '2026-09-15T04:00:00.000Z',
};

function library() {
  const root = mkdtempSync(join(tmpdir(), 'press-promote-'));
  const paths: LibraryPaths = {
    registry: join(root, 'screenshots.json'),
    artwork: join(root, 'artwork'),
    pins: join(root, 'pins.json'),
  };
  const entry = (key: string, extra: Record<string, unknown> = {}) => ({
    context: key.split('/')[1],
    page: key.split('/')[1],
    file: `source/screenshots/${key}.png`,
    run: 'run-old',
    sha256: 'c'.repeat(64),
    ...extra,
  });
  writeFileSync(
    paths.registry,
    `${JSON.stringify(
      {
        'ios/wallet-navy': entry('ios/wallet-navy', { context: 'wallet-appearance', page: 'wallet', wallpaperId: 'navy' }),
        'ios/receive-qr': entry('ios/receive-qr', {
          availability: 'unavailable',
          freshness: 'stale',
          unavailableReason: 'old pills',
        }),
        'ios/ai': entry('ios/ai'),
        'ios/wallet': entry('ios/wallet'),
      },
      null,
      2
    )}\n`
  );
  return { root, paths, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function candidate(root: string, runId: string, shots: { key: string; bytes: Buffer }[], platform = 'ios') {
  const dir = join(root, runId, 'press');
  mkdirSync(dir, { recursive: true });
  const screenshots = shots.map(({ key, bytes }) => {
    const file = `${key.split('/')[1]}.png`;
    writeFileSync(join(dir, file), bytes);
    return { file, key, context: key.split('/')[1], page: key.split('/')[1], sha256: sha(bytes) };
  });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ runId, platform, startedAt: '2026-09-15T05:00:00.000Z', screenshots })
  );
  return dir;
}

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

test('promotes exact bytes and replaces capture provenance, keeping curated fields', () => {
  const { root, paths, cleanup } = library();
  try {
    const qr = Buffer.from('new receive qr');
    const navy = Buffer.from('new navy wallet');
    const dir = candidate(root, '2026-09-15T05-00-00-000Z-abcd1234', [
      { key: 'ios/receive-qr', bytes: qr },
      { key: 'ios/wallet-navy', bytes: navy },
    ]);
    expect(promoteCandidates([dir], { builds: { ios: build }, appSource }, paths)).toEqual(['ios/receive-qr', 'ios/wallet-navy']);
    expect(readFileSync(join(paths.artwork, 'source/screenshots/ios/receive-qr.png'))).toEqual(qr);
    const registry = read(paths.registry);
    expect(registry['ios/receive-qr']).toEqual({
      context: 'receive-qr',
      page: 'receive-qr',
      file: 'source/screenshots/ios/receive-qr.png',
      run: 'run-2026-09-15T05-00-00-000Z-abcd1234',
      sha256: sha(qr),
      capturedAt: '2026-09-15T05:00:00.000Z',
      nativeBuild: build,
      appSource,
    });
    expect(registry['ios/wallet-navy']).toMatchObject({ context: 'wallet-appearance', page: 'wallet', wallpaperId: 'navy', sha256: sha(navy) });
    expect(registry['ios/ai'].run).toBe('run-old');
    expect(readFileSync(paths.registry, 'utf8')).toStartWith('{\n  "');
  } finally {
    cleanup();
  }
});

test('refuses to promote without a native build stamp or with changed bytes, writing nothing', () => {
  const { root, paths, cleanup } = library();
  try {
    const before = readFileSync(paths.registry, 'utf8');
    const dir = candidate(root, 'run-a', [{ key: 'ios/ai', bytes: Buffer.from('ai') }]);
    expect(() => promoteCandidates([dir], { builds: {}, appSource }, paths)).toThrow('No native build stamp');
    expect(() => promoteCandidates([dir], { builds: { ios: build }, appSource: undefined }, paths)).toThrow(
      'No app source stamp'
    );
    writeFileSync(join(dir, 'ai.png'), 'tampered');
    expect(() => promoteCandidates([dir], { builds: { ios: build }, appSource }, paths)).toThrow('Candidate hash mismatch');
    expect(readFileSync(paths.registry, 'utf8')).toBe(before);
    expect(existsSync(join(paths.artwork, 'source/screenshots/ios/ai.png'))).toBe(false);
  } finally {
    cleanup();
  }
});

test('store pins move only when the whole pinned set comes from one stamped run', () => {
  const { root, paths, cleanup } = library();
  try {
    writeFileSync(
      paths.pins,
      `${JSON.stringify(
        {
          ios: {
            run: 'run-old',
            screenshots: [
              { file: 'source/screenshots/ios/ai-chat.png', label: 'AI', sha256: 'c'.repeat(64) },
              { file: 'source/screenshots/ios/wallet.png', label: 'WALLET', sha256: 'c'.repeat(64) },
            ],
          },
        },
        null,
        2
      )}\n`
    );
    const ai = Buffer.from('ai v2');
    promoteCandidates([candidate(root, 'partial', [{ key: 'ios/ai', bytes: ai }])], { builds: { ios: build }, appSource }, paths);
    expect(read(paths.pins).ios.run).toBe('run-old');
    const wallet = Buffer.from('wallet v2');
    promoteCandidates(
      [candidate(root, 'store', [{ key: 'ios/ai', bytes: ai }, { key: 'ios/wallet', bytes: wallet }])],
      { builds: { ios: build }, appSource },
      paths
    );
    expect(read(paths.pins).ios).toMatchObject({
      run: 'run-store',
      screenshots: [{ label: 'AI', sha256: sha(ai) }, { label: 'WALLET', sha256: sha(wallet) }],
    });
  } finally {
    cleanup();
  }
});

test('refresh failures are recorded on existing entries without withdrawing their capture', () => {
  const { paths, cleanup } = library();
  try {
    recordRefreshFailures(
      [
        { key: 'ios/ai', reason: 'T12 waitFor failed' },
        { key: 'ios/not-registered', reason: 'ignored' },
      ],
      '2026-09-15T06:00:00.000Z',
      paths
    );
    const registry = read(paths.registry);
    expect(registry['ios/ai']).toMatchObject({
      run: 'run-old',
      lastRefreshFailure: { at: '2026-09-15T06:00:00.000Z', reason: 'T12 waitFor failed' },
    });
    expect(registry['ios/ai'].freshness).toBeUndefined();
    expect(registry).not.toHaveProperty('ios/not-registered');
  } finally {
    cleanup();
  }
});
