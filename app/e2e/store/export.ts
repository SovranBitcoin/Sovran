import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { RunManifest } from '../core/manifest';

export const STORE_PAGES = [
  'wallet',
  'contacts',
  'profile',
  'balance-split',
  'receive',
  'receive-qr',
  'send',
  'mint-select',
  'mint-info',
  'transactions',
  'lightning-receive',
  'feed',
  'notifications',
  'ai',
] as const;

const PHONE_SELECTION = [
  'wallet',
  'feed',
  'contacts',
  'transactions',
  'lightning-receive',
  'notifications',
  'ai',
  'mint-info',
];
const IPHONE_SELECTION = [...PHONE_SELECTION, 'profile', 'receive-qr'];

const TARGETS = {
  ios: [
    { id: 'app-store', label: 'App Store', note: 'Upload as 6.9-inch iPhone screenshots.' },
    {
      id: 'freedom-store',
      label: 'Freedom Store',
      note: 'Host these iPhone PNGs and use their HTTPS URLs in the AltStore source screenshots array.',
    },
    {
      id: 'website',
      label: 'Website',
      note: 'iPhone media; the release pipeline currently uses approved App Store images.',
    },
  ],
  android: [
    {
      id: 'google-play',
      label: 'Google Play',
      note: 'Upload all eight as phone screenshots. The separate 1024 × 500 feature graphic is not a screenshot.',
    },
    {
      id: 'zapstore',
      label: 'Zapstore',
      note: 'Use these Android PNGs as zsp images (local paths or hosted HTTPS URLs).',
    },
    {
      id: 'github-apk',
      label: 'GitHub APK',
      note: 'Optional Android release media; GitHub has no phone screenshot slot.',
    },
    {
      id: 'website',
      label: 'Website',
      note: 'Android media; retain the platform label when hosting.',
    },
  ],
} as const;

/** Publish only a complete, successful native set. Originals and private debug
 * evidence stay in the run; the gallery contains all selected pages; each store archive has its own capped selection. */
export async function exportStoreScreenshots(runDir: string): Promise<string> {
  const manifest: RunManifest = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8'));
  if (
    manifest.suite !== 'store-screenshots' ||
    manifest.proof !== 'product-run' ||
    !['sim', 'android'].includes(manifest.driver)
  )
    throw new Error('Store export requires a native store-screenshots run');
  const events = (await readFile(join(runDir, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const end = events.findLast((event) => event.type === 'run.end');
  if (!end || end.passed !== 1 || end.failed || end.skipped || end.deferred)
    throw new Error('Store export requires a complete passing run');
  const named = join(runDir, 'store.screenshots', 'named');
  const files = await readdir(named);
  const images = await Promise.all(
    STORE_PAGES.map(async (page, index) => {
      const matches = files.filter((file) => new RegExp(`^${page}-[0-9]+\\.png$`).test(file));
      if (matches.length !== 1)
        throw new Error(`Expected one ${page} capture, found ${matches.length}`);
      const source = join(named, matches[0]);
      const { width, height } = await sharp(source).metadata();
      const stats = await sharp(source).stats();
      if (stats.channels.slice(0, 3).every((channel) => channel.max - channel.min < 2))
        throw new Error(`Blank or fully masked screenshot: ${page}`);
      if (!width || !height || width >= height)
        throw new Error(`Invalid portrait screenshot: ${page}`);
      if (
        manifest.driver === 'sim' &&
        !['1260x2736', '1290x2796', '1320x2868'].includes(`${width}x${height}`)
      )
        throw new Error(`iPhone capture ${width}x${height} is not a supported 6.9-inch store size`);
      if (manifest.driver === 'android' && (width < 1080 || height < 1920))
        throw new Error(`Android capture ${width}x${height} is too small for a 1080 × 1920 export`);
      return {
        page,
        source,
        file: `${String(index + 1).padStart(2, '0')}-${page}.png`,
        sourceWidth: width,
        sourceHeight: height,
        width: manifest.driver === 'android' ? 1080 : width,
        height: manifest.driver === 'android' ? 1920 : height,
      };
    })
  );
  const destination = join(runDir, 'store');
  const staging = join(runDir, `.store-${crypto.randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const image of images) {
      let pipeline = sharp(image.source).flatten({ background: 'black' }).toColourspace('srgb');
      if (manifest.driver === 'android')
        pipeline = pipeline.resize(1080, 1920, { fit: 'contain', background: 'black' });
      await pipeline.png().toFile(join(staging, image.file));
    }
    const platform = manifest.driver === 'sim' ? 'ios' : 'android';
    const targets = TARGETS[platform].map((target) => {
      const pages: readonly string[] =
        target.id === 'website'
          ? STORE_PAGES
          : platform === 'ios'
            ? IPHONE_SELECTION
            : PHONE_SELECTION;
      return {
        ...target,
        archive: `${target.id}.zip`,
        files: pages.map((page) => images.find((image) => image.page === page)!.file),
      };
    });
    await writeFile(
      join(staging, 'manifest.json'),
      JSON.stringify(
        {
          version: 3,
          runId: manifest.runId,
          platform,
          demoContent: true,
          transformation:
            platform === 'android' ? 'contain-1080x1920-srgb-opaque' : 'native-size-srgb-opaque',
          targets,
          sourceFingerprint: manifest.sourceFingerprint,
          git: manifest.git,
          screenshots: images.map(({ source: _source, ...image }) => image),
        },
        null,
        2
      )
    );
    await writeFile(
      join(staging, 'README.txt'),
      [
        `Sovran ${platform} screenshots — ${images.length} screens with demo content.`,
        'screenshots.zip is the complete review gallery. Use the store-specific archive for its upload selection. Demo captures do not prove payment settlement.',
        'Original captures remain in the run directory. PNGs are opaque sRGB; Android is fitted inside 1080 × 1920 without cropping or stretching.',
        ...targets.map(
          (target) => `${target.label}: ${target.files.length} images. ${target.note}`
        ),
        'No assets have been uploaded or published.',
        '',
      ].join('\n')
    );
    await promisify(execFile)('zip', [
      '-q',
      '-j',
      join(staging, 'screenshots.zip'),
      ...images.map((image) => join(staging, image.file)),
      join(staging, 'manifest.json'),
      join(staging, 'README.txt'),
    ]);
    for (const target of targets) {
      await promisify(execFile)('zip', [
        '-q',
        '-j',
        join(staging, target.archive),
        ...target.files.map((file) => join(staging, file)),
        join(staging, 'manifest.json'),
        join(staging, 'README.txt'),
      ]);
    }
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return destination;
}
