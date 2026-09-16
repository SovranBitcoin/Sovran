import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { transform } from '@astrojs/compiler';
import { dev } from 'astro';
import { SCENE_PRESETS } from '../../scripts/lib/phone-frame.mjs';
import { websiteCaptures } from '../scripts/website-captures.mjs';
import { buildSourceCatalog } from '../scripts/source-catalog.mjs';
import { resolveCapture } from '../scripts/composition-recipe.mjs';

const site = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, site), 'utf8');

test('development retains workbench routes and the guarded source API', async () => {
  const server = await dev({ root: site, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  try {
    const origin = `http://127.0.0.1:${server.address.port}`;
    for (const path of ['/dev', '/screenshots', '/logos', '/social', '/mockups', '/scenes/custom', '/scenes/hero']) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toContain('noindex');
    }
    const response = await fetch(`${origin}/__artwork/sources`);
    expect(response.status).toBe(200);
    expect((await response.json()).captures.length).toBeGreaterThan(6);
  } finally { await server.stop(); }
}, 20000);

// Exercise the real Vite selected-import boundary without building the site or images.
// Only Astro's image metadata loader is replaced, using actual PNG headers.
async function loadCatalog(tamper = false) {
  const server = await createServer({
    root: fileURLToPath(site), configFile: false, logLevel: 'silent',
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true },
    plugins: [websiteCaptures(), {
      name: 'tampered-hash-fixture',
      transform(code, id) {
        if (tamper && id === '\0virtual:sovran-website-captures') return code.replace(/sha256: "[a-f0-9]{64}"/, `sha256: "${'0'.repeat(64)}"`);
      },
    }, {
      name: 'workbench-image-metadata', enforce: 'pre',
      load(id) {
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

test('the public scene catalog admits only selected, hash-matching captures with semantic alt metadata', async () => {
  const { captures, resolveScene } = await loadCatalog();
  const catalog = await buildSourceCatalog(fileURLToPath(new URL('../../', import.meta.url)));
  const available = Object.values(captures) as any[];
  expect(available.length).toBe(6);
  for (const capture of available) {
    const bytes = readFileSync(capture.image.fsPath);
    const source = resolveCapture(catalog, capture.key);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
    expect(capture.alt).toBe(source.context.alt ?? source.title);
  }
  expect(Object.keys(captures).every(key => key.startsWith('ios/'))).toBe(true);
  expect(captures['ios/wallet'].alt).toContain('transaction history');
  for (const key of ['ios/settings-keyring', 'ios/receive-qr-p2pk', 'ios/thread']) {
    expect(captures[key]).toBeUndefined();
    expect(() => resolveScene({ preset: 'single-front', screenshots: [key] })).toThrow();
  }
  expect(() => resolveScene({ screenshots: ['android/wallet'] })).toThrow();
});

test('retained captures declare one reviewed device, and off-profile ones are withheld', async () => {
  const catalog = await buildSourceCatalog(fileURLToPath(new URL('../../', import.meta.url)));
  const frames = new Map<string, Set<string>>();
  for (const capture of catalog.captures.filter((item: any) => item.available))
    frames.set(
      capture.platform,
      (frames.get(capture.platform) ?? new Set()).add(capture.frameId)
    );
  // Android has exactly one body. A store-delivery capture is a different
  // device, so it is withheld with its reason instead of being reframed.
  expect([...(frames.get('android') ?? [])]).toEqual(['android-emulator']);
  for (const frameId of frames.get('ios') ?? [])
    expect(['iphone-17-pro', 'iphone-17-pro-max']).toContain(frameId);
  const wallet = catalog.captures.find((item: any) => item.id === 'android/wallet');
  expect(wallet.available).toBeFalsy();
  expect(wallet.reason).toContain('1080x1920');
  // The workbench says the device beside each image, not only inside evidence.
  expect(read('../site/scripts/catalog-browser.mjs')).toContain('off library-v1');
});

test('the adapter rejects image metadata that changes after recipe validation', async () => {
  await expect(loadCatalog(true)).rejects.toThrow('Website capture changed during build');
});

test('homepage scenes resolve the named declarative phone selections, not collection combinations', async () => {
  const { pageScenes, resolveScene } = await loadCatalog();
  const config = JSON.parse(read('../press/website.json'));
  for (const [name, scene] of Object.entries(config.scenes) as [string, any][]) {
    expect(pageScenes[name].screenshots).toEqual(scene.phones.map(id => config.phones[id].captureId));
    expect(resolveScene({ scene: name }).phones.map(phone => phone.key)).toEqual(pageScenes[name].screenshots);
  }
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

test('website artwork lists only selected recipes and links to the local composer', () => {
  const source = read('src/pages/mockups.astro');
  expect(source).not.toContain('PhoneScene');
  expect(source).toContain('websiteAssetStatus');
  expect(source).toContain('press/website.json');
  expect(source).toContain('recipeHash(recipe)');
  expect(source).toContain('Blocked:');
  expect(source).not.toContain('collectionPairings');
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
