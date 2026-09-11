import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { exportStoreScreenshots, STORE_PAGES } from './export';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(proof = 'product-run', driver = 'android', width = 1080, height = 1920) {
  const dir = await mkdtemp(join(tmpdir(), 'sovran-store-export-'));
  dirs.push(dir);
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      suite: 'store-screenshots',
      proof,
      driver,
      runId: 'test',
      sourceFingerprint: 'fixture',
    })
  );
  await writeFile(
    join(dir, 'events.jsonl'),
    JSON.stringify({ type: 'run.end', passed: 1, failed: 0, skipped: 0, deferred: 0 })
  );
  const named = join(dir, 'store.screenshots', 'named');
  await mkdir(named, { recursive: true });
  const png = await sharp({
    create: { width, height, channels: 4, background: 'navy' },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="500"><rect x="40" y="40" width="300" height="400" fill="white"/></svg>'
        ),
      },
    ])
    .png()
    .toBuffer();
  for (const [i, page] of STORE_PAGES.entries())
    await writeFile(join(named, `${page}-${i + 1}.png`), png);
  return { dir, named };
}
test('exports a complete numbered native gallery, archive and explicit demo provenance', async () => {
  const { dir } = await fixture();
  const out = await exportStoreScreenshots(dir);
  expect((await readdir(out)).filter((file) => file.endsWith('.png'))).toHaveLength(
    STORE_PAGES.length
  );
  expect(await sharp(join(out, '01-wallet.png')).metadata()).toMatchObject({
    width: 1080,
    height: 1920,
    hasAlpha: false,
  });
  expect(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'))).toMatchObject({
    demoContent: true,
    platform: 'android',
  });
  expect((await readFile(join(out, 'screenshots.zip'))).subarray(0, 2).toString()).toBe('PK');
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  expect(manifest.targets.map((target: { id: string }) => target.id)).toEqual([
    'google-play',
    'zapstore',
    'github-apk',
    'website',
  ]);
  for (const target of manifest.targets) {
    expect((await readFile(join(out, target.archive))).subarray(0, 2).toString()).toBe('PK');
    expect(target.files).toHaveLength(target.id === 'website' ? STORE_PAGES.length : 8);
  }
});
test('preserves native iPhone dimensions and exports only iOS destinations', async () => {
  const { dir } = await fixture('product-run', 'sim', 1320, 2868);
  const out = await exportStoreScreenshots(dir);
  expect(await sharp(join(out, '01-wallet.png')).metadata()).toMatchObject({
    width: 1320,
    height: 2868,
    hasAlpha: false,
    space: 'srgb',
  });
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  expect(manifest.targets.map((target: { id: string }) => target.id)).toEqual([
    'app-store',
    'freedom-store',
    'website',
  ]);
  expect(manifest.targets[0].files).toHaveLength(10);
  expect(new Set(manifest.targets[0].files).size).toBe(10);
});
test('fits a tall Android capture without cropping and preserves original pixels', async () => {
  const { dir, named } = await fixture('product-run', 'android', 1080, 2400);
  const original = await readFile(join(named, 'wallet-1.png'));
  const out = await exportStoreScreenshots(dir);
  const { data, info } = await sharp(join(out, '01-wallet.png'))
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: 1080, height: 1920, channels: 3 });
  // Fitting 1080x2400 yields 864x1920 content, centered with 108px side bars.
  expect([...data.subarray(0, 3)]).toEqual([0, 0, 0]);
  const topContentPixel = 110 * info.channels;
  expect([...data.subarray(topContentPixel, topContentPixel + 3)]).toEqual([0, 0, 128]);
  expect(await readFile(join(named, 'wallet-1.png'))).toEqual(original);
});
test('rejects unsupported iPhone sizes and low-resolution Android sources', async () => {
  const iphone = await fixture('product-run', 'sim');
  await expect(exportStoreScreenshots(iphone.dir)).rejects.toThrow('6.9-inch');
  const android = await fixture('product-run', 'android', 800, 1920);
  await expect(exportStoreScreenshots(android.dir)).rejects.toThrow('too small');
});
test('rejects fake runs and incomplete captures without publishing a partial set', async () => {
  const fake = await fixture('orchestration-smoke');
  await expect(exportStoreScreenshots(fake.dir)).rejects.toThrow('native');
  const { dir, named } = await fixture();
  await rm(join(named, 'wallet-1.png'));
  await expect(exportStoreScreenshots(dir)).rejects.toThrow('Expected one wallet');
  expect(await readdir(dir)).not.toContain('store');
});
test('rejects failed runs and completely masked frames', async () => {
  const { dir, named } = await fixture();
  await writeFile(
    join(named, 'wallet-1.png'),
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: 'black' } })
      .png()
      .toBuffer()
  );
  await expect(exportStoreScreenshots(dir)).rejects.toThrow('Blank or fully masked');
  await writeFile(
    join(dir, 'events.jsonl'),
    JSON.stringify({ type: 'run.end', passed: 0, failed: 1 })
  );
  await expect(exportStoreScreenshots(dir)).rejects.toThrow('complete passing');
});
