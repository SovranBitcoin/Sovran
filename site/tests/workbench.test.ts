import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from '@astrojs/compiler';
import { dev } from 'astro';
import { CANONICAL_PAGES } from '../../app/e2e/schema/pages';
import { SCENE_PRESETS } from '../../scripts/lib/phone-frame.mjs';
import { buildSourceCatalog } from '../scripts/source-catalog.mjs';

const site = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, site), 'utf8');

test('development retains workbench routes and the guarded source API', async () => {
  const server = await dev({ root: site, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  try {
    const origin = `http://127.0.0.1:${server.address.port}`;
    for (const path of ['/dev', '/screenshots', '/logos', '/social', '/mockups']) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toContain('noindex');
    }
    const response = await fetch(`${origin}/__artwork/sources`);
    expect(response.status).toBe(200);
    expect((await response.json()).captures.length).toBeGreaterThan(6);
  } finally { await server.stop(); }
}, 20000);

test('the catalog retains every canonical baseline slot on both platforms', async () => {
  const catalog = await buildSourceCatalog(fileURLToPath(new URL('../../', import.meta.url)));
  const baseline = catalog.captures.filter((capture: any) => capture.baseline);
  expect(baseline.length).toBe(CANONICAL_PAGES.length * 2);
  for (const platform of ['ios', 'android']) for (const page of CANONICAL_PAGES)
    expect(baseline.some((capture: any) => capture.id === `${platform}/${page}`)).toBe(true);
});

test('retained captures declare reviewed devices and show profile information', async () => {
  const catalog = await buildSourceCatalog(fileURLToPath(new URL('../../', import.meta.url)));
  const frames = new Map<string, Set<string>>();
  for (const capture of catalog.captures.filter((item: any) => item.available))
    frames.set(
      capture.platform,
      (frames.get(capture.platform) ?? new Set()).add(capture.frameId)
    );
  // Every available capture uses a reviewed body. Rejection of off-profile
  // images is exercised with explicit inputs in composition.test.mjs.
  expect([...(frames.get('android') ?? [])]).toEqual(['android-emulator']);
  for (const frameId of frames.get('ios') ?? [])
    expect(['iphone-17-pro', 'iphone-17-pro-max']).toContain(frameId);
  // The workbench says the device beside each image, not only inside evidence.
  expect(read('../site/scripts/catalog-browser.mjs')).toContain('off library-v1');
});

test('owned Astro pages compile and share an explicit noindex layout', async () => {
  expect(read('src/layouts/Dev.astro')).toContain('name="robots" content="noindex, nofollow"');
  for (const path of ['dev', 'mockups', 'screenshots']) {
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

