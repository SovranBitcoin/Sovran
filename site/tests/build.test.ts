import { expect, test } from 'bun:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { websiteAssetStatus } from '../scripts/website-assets.mjs';
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
  for (const path of ['index.html', 'download/index.html', 'releases/index.html', 'roadmap/index.html', 'terms/index.html', 'privacy/index.html', '404.html', 'health', 'build.json', 'legal/documents.json']) expect(existsSync(new URL(`dist/${path}`, site))).toBe(true);
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
    expect(html).toContain('src="/downloads/download-qr.svg"');
    expect(html).toContain('Checking availability...');
  }
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
test('only configured captures enter the public import graph; source inputs stay in the build stage', () => {
  const source = read('src/lib/phoneGeometry.ts');
  const captures = JSON.parse(read('../press/artwork/source/screenshots.json'));
  expect(source).not.toContain('import.meta.glob');
  const website = JSON.parse(read('../press/website.json'));
  const inputs = [...new Set(Object.values(website.phones).map((phone: any) => phone.captureId))];
  expect(inputs).toHaveLength(6);
  expect(source).toContain('virtual:sovran-website-captures');
  expect(read('scripts/website-captures.mjs')).toContain('readCaptureSource(repoRoot, capture)');
  expect(read('Dockerfile').split('FROM nginx:')[1]).not.toContain('COPY press/');
  expect(read('Dockerfile')).toContain('COPY scripts/lib/phone-frame.mjs');
  for (const key of inputs) {
    const capture = captures[key];
    expect(capture.file).toBe(`source/screenshots/${key}.png`);
    expect(capture.run).toMatch(/^run-/);
    const bytes = readFileSync(new URL(`../press/artwork/${capture.file}`, site));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(capture.sha256);
  }
});
test('original composition and native no-JS disclosures survive the build', () => {
  const html = read('dist/index.html');
  const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map(match => match[1]);
  expect(sections).toEqual(['hero', 'features', 'wallet', 'social', 'ai', 'offline', 'stack', 'faq', 'download']);
  expect(html).toContain('Sound money meets freedom of expression.');
  expect(html).toContain('data-scene="hero"');
  expect(html).toContain('OpenSats');
  expect(html).not.toContain('Retained app captures');
  expect((html.match(/<summary>/g) ?? []).length).toBe(8);
  expect(html).toContain('data-capture-currentness=');
  expect(html).toContain('data-capture-currentness="app-source-matched"');
});
test('production has no workbench pages, API, derived mockup tree or private capture bytes', () => {
  for (const path of ['dev', 'screenshots', 'logos', 'social/index.html', 'social/manifest.json', 'mockups', 'scenes', '__artwork']) expect(existsSync(new URL(`dist/${path}`, site))).toBe(false);
  const files = readdirSync(new URL('dist/_astro/', site));
  expect(files.some(file => /catalog-browser|composition|custom\.astro|social\.astro/.test(file))).toBe(false);
  const allowed = Object.values(JSON.parse(read('../press/website.json')).phones).map((phone: any) => phone.captureId.split('/')[1]);
  for (const file of files.filter(file => /\.(png|webp)$/.test(file))) expect(allowed).toContain(file.split('.')[0]);
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
