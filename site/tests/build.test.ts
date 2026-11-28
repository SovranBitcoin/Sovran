import { expect, test } from 'bun:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { websiteAssetStatus } from '../scripts/website-assets.mjs';
import { siteCopy } from '../../copy/src/site';
const site = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, site), 'utf8');
const documents = JSON.parse(read('../copy/legal/documents.json'));
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

test('legal JSON is the canonical byte-for-byte bundle with matching fingerprints', () => {
  expect(read('dist/legal/documents.json')).toBe(read('../copy/legal/documents.json'));
  for (const id of ['terms', 'privacy']) {
    const revision = createHash('sha256').update(JSON.stringify({ operator: documents.operator, document: documents[id], publicationReady: documents.publicationReady })).digest('hex');
    expect(JSON.parse(read('dist/build.json')).revisions[id]).toBe(revision);
    const html = read(`dist/${id}/index.html`);
    expect(html).toContain(revision);
    expect(html).toContain(escape(documents.operator.address));
    for (const section of documents[id].sections) {
      expect(html).toContain(escape(section.title));
      for (const paragraph of section.paragraphs) expect(html).toContain(escape(paragraph));
    }
  }
});
test('legal pages share a static shell, readable prose column, and complete section anchors', () => {
  for (const id of ['terms', 'privacy']) {
    const html = read(`dist/${id}/index.html`);
    expect(html).toContain('class="legal wrap section" aria-labelledby="legal-title"');
    expect(html).toContain('class="legal-header"');
    expect(html).toContain('class="legal-layout"');
    expect(html).toContain('class="legal-prose"');
    expect(html).toContain('class="legal-contents" aria-label="Document contents"');
    expect(html).toContain(`<h1 id="legal-title">${escape(documents[id].title)}</h1>`);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script\b|<astro-island\b/);
    const sections = [...html.matchAll(/<section id="(section-\d+)" tabindex="-1">([\s\S]*?)<\/section>/g)];
    expect(sections).toHaveLength(documents[id].sections.length);
    sections.forEach(([_, anchor, body], index) => {
      const section = documents[id].sections[index];
      expect(anchor).toBe(`section-${index + 1}`);
      expect(html).toContain(`<a href="#${anchor}">${escape(section.title)}</a>`);
      expect(body).toContain(`<h2>${escape(section.title)}</h2>`);
      expect([...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(match => match[1])).toEqual(section.paragraphs.map(escape));
    });
  }
});
test('all static routes and JSON revisions are built', () => {
  for (const path of ['index.html', 'download/index.html', 'faq/index.html', 'releases/index.html', 'roadmap/index.html', 'terms/index.html', 'privacy/index.html', '404.html', 'health', 'build.json', 'legal/documents.json']) expect(existsSync(new URL(`dist/${path}`, site))).toBe(true);
  expect(JSON.parse(read('dist/build.json')).revisions.terms).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(read('dist/build.json')).revisions.privacy).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(read('dist/build.json')).analytics).toBe('withheld');
});
test('HTML starts with all five channels disabled and without store links', () => {
  for (const path of ['index.html', 'download/index.html']) {
    const html = read(`dist/${path}`);
    for (const channel of ['appStore', 'freedomStore', 'googlePlay', 'githubApk', 'zapstore']) expect(html).toContain(`data-channel="${channel}"`);
    expect(html).not.toMatch(/href="https:\/\/(apps\.apple|play\.google|zapstore|freedomstore)/);
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('Not verified');
    const badges = [...html.matchAll(/<a\b[^>]*\bdata-action\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
    expect(badges).toHaveLength(5);
    for (const badge of badges) {
      expect(badge).not.toMatch(/\bhref=/);
      expect(badge).toContain('aria-disabled="true"');
      expect(badge).toContain('tabindex="-1"');
      expect(badge).toContain('<svg');
      expect(badge).not.toContain('className');
    }
    expect(html).toContain('aria-label="iOS downloads"');
    expect(html).toContain('aria-label="Android downloads"');
    expect(html).toContain('Checking availability...');
  }
  // The home page keeps the live check in compact form; the QR card stays on /download.
  expect(read('dist/download/index.html')).toContain('src="/downloads/download-qr.svg"');
  expect(read('dist/index.html')).not.toContain('download-qr');
  expect(read('dist/index.html')).toContain('class="downloads downloads-compact"');
});
test('no bundled channel snapshot, media endpoint dependency, analytics, private env, or React', () => {
  expect(existsSync(new URL('dist/releases/channels.json', site))).toBe(false);
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  for (const file of walk(new URL('dist', site).pathname).filter((path) => /\.(html|js|json)$/.test(path))) {
    const content = readFileSync(file, 'utf8');
    expect(content).not.toMatch(/releaseMedia\.json|releases\/media\.json|googletagmanager|google-analytics|plausible\.io|umami|posthog|WEBSITE_TOKEN|EXPO_PUBLIC_|@sovranbitcoin\/schemas|react-dom/);
  }
  expect(JSON.parse(read('package.json')).dependencies).toEqual({ astro: '5.18.2' });
});
test('the home hero ships only pre-cropped phone exports; capture sources stay in the build stage', () => {
  const html = read('dist/index.html');
  const images = [...html.matchAll(/(?:src|srcset)="([^"]+)"/g)].flatMap(match => match[1].split(', ').map(entry => entry.split(' ')[0]));
  expect(new Set(images.filter(src => src.startsWith('/hero/')))).toEqual(new Set(['/hero/wallet-600.avif', '/hero/wallet-900.avif', '/hero/wallet-600.webp', '/hero/wallet-900.webp']));
  for (const width of [600, 900]) for (const format of ['avif', 'webp']) expect(existsSync(new URL(`dist/hero/wallet-${width}.${format}`, site))).toBe(true);
  // scripts/hero-image.mjs crops 2310 of the capture's 2868 rows, above its tab bar.
  expect(html).toMatch(/<img src="\/hero\/wallet-600\.webp" width="600" height="1050" alt="[^"]{20,}"/);
  expect(read('scripts/hero-image.mjs')).toContain('cropHeight: 2310');
  expect(readdirSync(new URL('dist/_astro/', site)).filter(file => /\.(png|webp|avif|jpe?g)$/.test(file))).toEqual([]);
  expect(read('Dockerfile').split('FROM nginx:')[1]).not.toContain('COPY press/');
});
test('home is one screen: hero, proof line, footer; FAQ caveats live on /faq', () => {
  const html = read('dist/index.html');
  const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map(match => match[1]);
  expect(sections).toEqual(['hero', 'proof']);
  expect(html).toContain('data-scene="hero"');
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html).toContain('id="download"');
  expect(html).toContain('OpenSats');
  expect(html).toContain('MPL-2.0');
  expect(html).toContain(escape(siteCopy.risk));
  expect(html).toMatch(/<header\b[\s\S]*<main id="main">[\s\S]*<footer\b/);
  for (const href of ['/download', '/releases', '/roadmap', '/faq', '/terms', '/privacy', 'https://github.com/SovranBitcoin/Sovran']) expect(html).toContain(`href="${href}"`);
  expect(html).not.toMatch(/<details\b|<summary\b/);
  const faq = read('dist/faq/index.html');
  for (const item of siteCopy.faq) {
    expect(faq).toContain(escape(item.question));
    expect(faq).toContain(escape(item.answer));
  }
  expect(faq).toContain(escape(siteCopy.risk));
  expect(faq).not.toMatch(/<script\b/);
});
test('pages load only the two Mona Sans weights in use, as preloaded WOFF2', () => {
  const html = read('dist/index.html');
  const preloads = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin>/g)].map(match => match[1]);
  expect(preloads.sort()).toEqual(['/fonts/MonaSans/MonaSans-ExtraBold.woff2', '/fonts/MonaSans/MonaSans-Regular.woff2']);
  expect(readdirSync(new URL('dist/fonts/MonaSans/', site)).sort()).toEqual(['MonaSans-ExtraBold.woff2', 'MonaSans-Regular.woff2', 'OFL.txt']);
  const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => read(`dist${match[1]}`)).join('');
  expect(css.match(/@font-face/g)).toHaveLength(2);
  expect(css).toContain('font-display:swap');
});
test('production has no workbench pages, API, derived mockup tree or private capture bytes', () => {
  for (const path of ['dev', 'screenshots', 'logos', 'social/index.html', 'social/manifest.json', 'mockups', 'scenes', '__artwork']) expect(existsSync(new URL(`dist/${path}`, site))).toBe(false);
  const files = readdirSync(new URL('dist/_astro/', site));
  expect(files.some(file => /catalog-browser|composition|custom\.astro|social\.astro/.test(file))).toBe(false);
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  for (const file of walk(new URL('dist/', site).pathname).filter(file => /\.(html|js|json)$/.test(file))) expect(readFileSync(file, 'utf8')).not.toMatch(/__artwork|source\/screenshots|DRAFT - capture|catalog-browser/);
});
test('social metadata only advertises a current, fingerprinted recipe export', async () => {
  const manifest = JSON.parse(read('public/social/manifest.json'));
  const hash = (file: URL) => createHash('sha256').update(readFileSync(file)).digest('hex');
  expect(hash(new URL('public/social/og.png', site))).toBe(manifest.images['og.png']);
  const current = (await websiteAssetStatus()).outputs.find(output => output.output === 'social/og.png')?.current ?? false;
  expect(read('dist/index.html').includes('property="og:image"')).toBe(current);
  const png = readFileSync(new URL('public/social/og.png', site));
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  expect(read('dist/index.html')).not.toContain(' style=');
});
