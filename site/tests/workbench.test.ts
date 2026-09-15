import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { transform } from '@astrojs/compiler';
import registry from '../../press/artwork/source/screenshots.json';
import { SCENE_PRESETS } from '../../scripts/lib/phone-frame.mjs';

const site = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, site), 'utf8');

// Exercise the real Vite glob/catalog boundary without building the site or images.
// Only Astro's image metadata loader is replaced, using actual PNG headers.
async function loadCatalog(entries = registry) {
  const server = await createServer({
    root: fileURLToPath(site), configFile: false, logLevel: 'silent',
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true },
    plugins: [{
      name: 'workbench-image-metadata', enforce: 'pre',
      load(id) {
        if (id.endsWith('/source/screenshots.json')) return JSON.stringify(entries);
        if (!id.endsWith('.png')) return;
        const bytes = readFileSync(id);
        return `export default ${JSON.stringify({
          src: `/@fs${id}`, fsPath: id, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png',
        })}`;
      },
    }],
  });
  try { return await server.ssrLoadModule('/src/lib/phoneGeometry.ts'); }
  finally { await server.close(); }
}

test('the workbench catalog admits only retained, hash-matching captures with authored alt metadata', async () => {
  const { screenshotCatalog, captures, resolveScene } = await loadCatalog();
  const available = screenshotCatalog.filter(capture => capture.image);
  expect(available.length).toBeGreaterThan(20);
  for (const capture of available) {
    const bytes = readFileSync(capture.image.fsPath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(capture.sha256);
    expect(capture.run).toStartWith('run-');
    expect(capture.alt).toBe(capture.context.alt);
    expect(capture.reason).toBe('');
  }
  expect(Object.keys(captures).every(key => key.startsWith('ios/'))).toBe(true);
  expect(captures['ios/wallet'].alt).toContain('transaction history');
  for (const key of ['ios/settings-keyring', 'ios/receive-qr-p2pk', 'ios/thread']) {
    expect(screenshotCatalog.find(capture => capture.key === key).image).toBeUndefined();
    expect(captures[key]).toBeUndefined();
    expect(() => resolveScene({ preset: 'single-front', screenshots: [key] })).toThrow();
  }
  expect(() => resolveScene({ screenshots: ['android/wallet'] })).toThrow();
});

test('unavailable, unauthenticated, tampered, and absent collection members remain capture requests', async () => {
  const entries = structuredClone(registry);
  entries['ios/wallet'].sha256 = '0'.repeat(64);
  entries['ios/feed'].run = null;
  Object.assign(entries['ios/dm-chat'], { availability: 'unavailable', unavailableReason: 'Needs review.' });
  delete entries['ios/settings-keyring'];
  const { screenshotCatalog, captures } = await loadCatalog(entries);
  for (const key of ['ios/wallet', 'ios/feed', 'ios/dm-chat', 'ios/settings-keyring']) {
    const capture = screenshotCatalog.find(capture => capture.key === key);
    expect(capture.image).toBeUndefined();
    expect(capture.reason.length).toBeGreaterThan(0);
    expect(captures[key]).toBeUndefined();
  }
  expect(screenshotCatalog.find(capture => capture.key === 'ios/settings-keyring').context.caption).toContain('receiving keys');
});

test('gallery pairings are count-correct, ordered, unique, and never padded with missing captures', async () => {
  const { collectionPairings, collections, captures } = await loadCatalog();
  const available = Object.keys(captures);
  expect(collectionPairings(['a', 'b', 'c', 'd'], 2, ['a', 'b', 'c', 'd'])).toEqual([
    ['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd'], ['c', 'd'],
  ]);
  expect(collectionPairings(['a', 'a', 'missing'], 1, ['a'])).toEqual([['a']]);
  expect(collectionPairings(['a', 'missing'], 2, ['a'])).toEqual([]);
  for (const count of [0, 5, 1.5, NaN]) expect(collectionPairings(available, count, available)).toEqual([]);
  for (const story of collections) for (const count of [1, 2, 3, 4]) {
    const groups = collectionPairings(story.screenshots, count, available);
    expect(new Set(groups.map(group => group.join(','))).size).toBe(groups.length);
    for (const group of groups) {
      expect(group.length).toBe(count);
      expect(new Set(group).size).toBe(count);
      expect(group.every(key => available.includes(key))).toBe(true);
      expect(group).toEqual(story.screenshots.filter(key => group.includes(key)));
    }
  }
  const p2pk = collections.find(story => story.id === 'p2pk-receive');
  expect(collectionPairings(p2pk.screenshots, 2, available)).toEqual([]);
});

test('owned Astro pages compile and share an explicit noindex layout', async () => {
  expect(read('src/layouts/Dev.astro')).toContain('name="robots" content="noindex, nofollow"');
  for (const path of ['dev', 'mockups', 'screenshots', 'scenes/custom']) {
    const source = read(`src/pages/${path}.astro`);
    expect(source).toContain('<Dev title=');
    const compiled = await transform(source, { filename: `src/pages/${path}.astro` });
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === 1)).toEqual([]);
  }
  const compiled = await transform(read('src/layouts/Dev.astro'));
  expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === 1)).toEqual([]);
});

test('gallery renders one replaceable preview and enumerates the shared orientation atlas', () => {
  const source = read('src/pages/mockups.astro');
  expect(source).not.toContain('PhoneScene');
  expect(source.match(/document.createElement\('iframe'\)/g)).toHaveLength(1);
  expect(source).toContain('preview.replaceChildren()');
  expect(source).toContain('Object.entries(SCENE_PRESETS)');
  expect(source).toContain('href={`/scenes/${key}`}');
  expect(source).toContain('pose.rotateX');
  expect(source).toContain('pose.rotateY');
  expect(source).toContain('pose.rotateZ');
  expect(Object.values(SCENE_PRESETS).every(preset => preset.poses.length >= 1 && preset.poses.length <= 4)).toBe(true);
});

test('composer keeps CLI selectors, format query, exact export geometry, and contain semantics', () => {
  const source = read('src/pages/scenes/custom.astro');
  const css = read('src/styles/dev.css');
  expect(source).toContain('name="format"');
  expect(source).toContain('CANVAS_FORMATS[format]');
  expect(source).toContain('target.style.width = `${canvas.width}px`');
  expect(source).toContain('target.style.height = `${canvas.height}px`');
  expect(source).toContain("const isEmbed = !isExport && params.get('embed') === '1'");
  expect(source).toContain('preserveAspectRatio="xMidYMid meet"');
  expect(source).toContain('data-custom-scene');
  expect(source).toContain('class="phone-stage"');
  expect(source).toContain('class="phone-scene"');
  expect(source).toContain("target.dataset.ready = 'false'");
  expect(source).toContain("target.dataset.ready = 'true'");
  expect(source).toContain("new URLSearchParams({ preset, screenshots: selectedKeys.join(','), format })");
  expect(source).toContain('bun run --cwd site scripts/visual.mjs --export ../press/exports/NAME --preset ${preset} --screenshots ${selectedKeys.join(\',\')} --format ${format}');
  expect(source).toContain("--poses '${JSON.stringify(JSON.parse(poses))}'");
  expect(read('src/layouts/Dev.astro')).toContain("import '../components/phone-scene.css'");
  expect(css).toContain('.dev-scene .phone-scene { width: 100%; height: 100%; }');
  expect(css).toContain('.dev-scene svg { display: block; width: 100%; height: 100%; }');
  expect(css).toContain('background: transparent');
  expect(css).toContain('calc(100svh * var(--canvas-width) / var(--canvas-height))');
  expect(css).toContain('calc(100vw * var(--canvas-height) / var(--canvas-width))');
});
