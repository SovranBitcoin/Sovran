import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appSourceFingerprint, classifyCapture } from '../../scripts/lib/app-source.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const ARTWORK_ROOTS = Object.freeze([
  'press/artwork/generated', 'press/mockups', 'press/exports',
  'site/public/mockups', 'site/public/social', 'app/assets/brand/generated',
]);
// Global caveat: no catalogued image proves native build freshness. Render hashes
// prove a PNG matches its recorded inputs, not that a capture reflects the current
// native build. Stated once on the catalog, never repeated as a per-alias status.
export const CATALOG_CAVEATS = Object.freeze(['native-freshness-unverified']);
const excluded = /^(?:\..*|runs?|run-.*|private(?:-.*)?|captures?|native(?:-.*)?|e2e|node_modules)$/i;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const hashPattern = /^[a-f0-9]{64}$/;
const within = (root, path) => path === root || path.startsWith(`${root}${sep}`);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const entries = (value) => Object.entries(object(value));

export function isCurrentArtwork(statuses) {
  return statuses.includes('current-render') &&
    !['stale-render', 'draft', 'stale-known-capture', 'outdated-capture', 'untracked'].some((status) => statuses.includes(status));
}

// Reject every symlink, including ancestors: a fixed root cannot be redirected.
async function safePath(root, path) {
  if (!within(root, path)) throw new Error('Outside root');
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    root = resolve(root, part);
    if ((await lstat(root)).isSymbolicLink()) throw new Error('Symlink');
  }
  if (await realpath(path) !== path) throw new Error('Redirected path');
  return path;
}

function localPath(root, base, file) {
  if (typeof file !== 'string' || isAbsolute(file) || file.includes('\\') ||
      file.split('/').some((part) => part === '..' || excluded.test(part))) return null;
  const path = resolve(base, file);
  return within(root, path) ? path : null;
}

async function inspectPng(root, path, keepOpen = false) {
  await safePath(root, path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a file');
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, 24, 0);
    if (bytesRead !== 24 || !header.subarray(0, 8).equals(pngSignature) ||
        header.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Not a PNG');
    const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
    if (!width || !height) throw new Error('Invalid dimensions');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
    const image = { sha256: hash.digest('hex'), bytes: stat.size, width, height };
    if (keepOpen) return { ...image, handle };
    await handle.close();
    return image;
  } catch (error) { await handle.close(); throw error; }
}

export async function buildArtworkCatalog(repoRoot = repository) {
  const root = await realpath(repoRoot);
  const diagnostics = [], files = [], manifests = [];
  const artwork = resolve(root, 'press/artwork');
  const brand = resolve(root, 'app/assets/brand');
  let productVersion;
  const hashes = new Map();
  const json = async (path, optional = false) => {
    try { return object(JSON.parse(await readFile(await safePath(root, path), 'utf8'))); }
    catch (error) {
      if (!optional || error.code !== 'ENOENT') diagnostics.push(`Metadata unavailable: ${relative(root, path)}`);
      return {};
    }
  };
  const hashFile = async (path) => {
    if (!path) return null;
    if (!hashes.has(path)) hashes.set(path, (async () => {
      try {
        await safePath(root, path);
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (!(await handle.stat()).isFile()) return null;
          const hash = createHash('sha256');
          for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
          return hash.digest('hex');
        } finally { await handle.close(); }
      } catch { return null; }
    })());
    return hashes.get(path);
  };
  const walk = async (path, allowedRoot) => {
    try {
      await safePath(root, path);
      for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink() || excluded.test(entry.name)) continue;
        const child = resolve(path, entry.name);
        if (entry.isDirectory()) await walk(child, allowedRoot);
        else if (entry.isFile() && entry.name === 'manifest.json') manifests.push(child);
        else if (entry.isFile() && extname(entry.name).toLowerCase() === '.png') files.push({ path: child, allowedRoot });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') diagnostics.push(`Cannot scan: ${relative(root, path)}`);
    }
  };
  for (const directory of ARTWORK_ROOTS) await walk(resolve(root, directory), directory);
  const registry = await json(resolve(artwork, 'source/screenshots.json'));
  // Undefined outside a git checkout (fixtures), which leaves capture freshness unchecked.
  const currentAppFingerprint = appSourceFingerprint(root);
  const brandConfig = await json(resolve(root, 'app/assets/brand/source/brand.json'), true);
  const brandFiles = {
    mark: 'app/assets/brand/source/symbol.svg',
    wordmark: 'app/assets/brand/source/wordmark.svg',
    config: 'app/assets/brand/source/brand.json',
    font: brandConfig.versionFont,
  };
  const records = new Map();
  for (const manifestPath of manifests) {
    const manifest = await json(manifestPath);
    const add = (file, record, base = dirname(manifestPath)) => {
      const path = localPath(root, base, file);
      if (!path || !within(dirname(manifestPath), path)) return;
      if (!records.has(path)) records.set(path, []);
      records.get(path).push({ ...record, manifest: relative(root, manifestPath) });
    };
    for (const [key, concept] of entries(manifest.concepts)) {
      const conceptPath = localPath(root, artwork, `source/concepts/${key}.json`);
      const source = conceptPath ? await json(conceptPath, true) : {};
      const outputs = Array.isArray(concept.outputs) ? concept.outputs : [];
      for (const output of [...outputs, ...Object.values(object(concept.variants))]) {
        add(output.file, { ...output, family: output.family || concept.family || 'artwork', concept: key, source,
          title: output.title || concept.title || key,
          draft: output.draft || concept.draft,
        });
      }
    }
    for (const [platform, output] of entries(manifest.featureGraphic)) {
      add(output.file, { ...output, family: 'artwork', title: `Feature graphic (${platform})` });
    }
    if (manifestPath === resolve(brand, 'generated/manifest.json')) {
      const variants = Array.isArray(manifest.variants) ? manifest.variants : [];
      if (variants.some((variant) => variant.layout === 'version-lockup')) {
        productVersion = (await json(resolve(root, 'app/app.json'))).expo?.version;
      }
      for (const variant of [...variants, { ...object(manifest.androidAdaptive), layout: 'android-adaptive-icon' }]) {
        for (const output of Array.isArray(variant.pngs) ? variant.pngs : []) {
          add(output.file, { ...output, family: 'brand', layout: variant.layout, theme: variant.theme,
            title: [variant.layout, variant.theme].filter(Boolean).join(' '),
            sources: manifest.sources, tools: manifest.tools, productVersion: manifest.productVersion,
            brand: { mark: undefined, wordmark: undefined, font: undefined, config: undefined, ...object(manifest.sources) },
          }, brand);
        }
      }
    }
    for (const file of new Set([...Object.keys(object(manifest.images)), ...Object.keys(object(manifest.exports))])) {
      const image = manifest.images?.[file];
      add(file, { ...object(image), ...object(manifest.exports?.[file]),
        sha256: typeof image === 'string' ? image : image?.sha256,
        inputs: manifest.inputs, renderer: manifest.renderer, provenance: manifest.provenance,
      });
    }
  }
  // Hash inputs are metadata, never image-serving authority. Only known source trees
  // may be read, and their contents (including native captures) are never returned.
  const inputPath = (file, base) => {
    if (registry[file]?.file) { file = registry[file].file; base = artwork; }
    else if (typeof file === 'string' && file.startsWith('press/')) base = root;
    const path = localPath(root, base, file);
    if (!path) return null;
    const name = relative(root, path).split(sep).join('/');
    return /^(?:press\/artwork\/source\/|scripts\/|site\/(?:src|scripts|public)\/|app\/assets\/(?:brand|fonts)\/|copy\/)/.test(name)
      ? path : null;
  };
  const byHash = new Map();
  for (const { path, allowedRoot } of files) {
    let image;
    try { image = await inspectPng(root, path); }
    catch { diagnostics.push(`Excluded unreadable or non-PNG file: ${relative(root, path)}`); continue; }
    const alias = { path: relative(root, path), family: allowedRoot.includes('brand') ? 'brand' :
      allowedRoot.includes('artwork') ? 'artwork' : allowedRoot.endsWith('social') ? 'social' :
      allowedRoot.endsWith('exports') ? 'exports' : 'mockups', statuses: [], diagnostics: [], metadata: [] };
    const tracked = records.get(path) || [];
    for (const record of tracked) {
      let stale = false, checked = 0, incomplete = false;
      const checks = [
        [record.sourceHashes, artwork], [record.provenanceHashes, artwork],
        [record.renderer, root], [record.inputs, root],
      ];
      for (const [map, base] of checks) for (const [file, expected] of entries(map)) {
        if (!hashPattern.test(expected)) { incomplete = true; continue; }
        checked++;
        if (await hashFile(inputPath(file, base)) !== expected) {
          stale = true;
          alias.diagnostics.push(`Changed or missing input: ${file}`);
        }
      }
      for (const [key, expected] of entries(record.brand)) {
        const file = brandFiles[key];
        if (!file || !hashPattern.test(expected)) { incomplete = true; continue; }
        checked++;
        if (await hashFile(inputPath(file, root)) !== expected) {
          stale = true;
          alias.diagnostics.push(`Changed or missing brand input: ${file}`);
        }
      }
      if (record.manifest === 'app/assets/brand/generated/manifest.json' && record.layout === 'version-lockup') {
        if (typeof record.productVersion !== 'string' || !record.productVersion ||
            typeof productVersion !== 'string' || !productVersion) {
          incomplete = true;
          alias.diagnostics.push('Product version unavailable');
        } else if (record.productVersion !== productVersion) {
          stale = true;
          alias.diagnostics.push('Product version differs from app/app.json');
        }
      }
      if (record.rendererHash) {
        if (entries(record.renderer).length) {
          const hash = createHash('sha256').update(`${JSON.stringify(record.renderer, null, 2)}\n`).digest('hex');
          if (hash !== record.rendererHash) {
            stale = true;
            alias.diagnostics.push('Recorded renderer aggregate hash differs');
          }
        } else incomplete = true;
      }
      if (hashPattern.test(record.sha256) && record.sha256 !== image.sha256) {
        stale = true;
        alias.diagnostics.push('Output bytes differ from manifest');
      }
      alias.statuses.push(stale ? 'stale-render' : checked && hashPattern.test(record.sha256) && !incomplete ? 'current-render' : 'untracked');
      if (record.draft) alias.statuses.push('draft');
      const references = new Set();
      for (const [file] of entries(record.sourceHashes)) references.add(inputPath(file, artwork));
      // Browser manifests may record the complete build input set. Prefer explicit
      // per-export screenshot keys; otherwise disclose conservative input scope.
      const screenshots = record.screenshots || record.source?.screenshots;
      const keys = Array.isArray(screenshots) ? screenshots : [];
      for (const key of keys) {
        if (typeof key !== 'string') continue;
        const fullKey = key.includes('/') ? key : `${record.source?.platform || 'ios'}/${key}`;
        references.add(fullKey);
        references.add(inputPath(key, artwork));
      }
      if (!keys.length) for (const [file] of entries(record.inputs)) references.add(inputPath(file, root));
      for (const [key, capture] of entries(registry)) {
        const capturePath = inputPath(capture.file, artwork);
        if (!references.has(key) && (!capturePath || !references.has(capturePath))) continue;
        const knownUsage = keys.length || entries(record.sourceHashes).length;
        if (capture.availability === 'unavailable' || capture.freshness === 'stale') {
          alias.statuses.push(knownUsage ? 'stale-known-capture' : 'capture-scope-unverified');
          alias.diagnostics.push(`${knownUsage ? '' : 'Build input, not confirmed image usage: '}${key}: ${capture.unavailableReason || capture.staleReason || 'Source registry marks this capture unavailable'}`);
        } else if (knownUsage && currentAppFingerprint) {
          const freshness = classifyCapture(capture, currentAppFingerprint);
          if (freshness === 'outdated' || freshness === 'unverified') {
            alias.statuses.push('outdated-capture');
            alias.diagnostics.push(`${key}: ${freshness === 'outdated' ? 'app source changed since capture' : 'captured before app-source stamping'}`);
          }
        }
      }
      alias.title ||= record.title || record.name || record.concept;
      if (typeof record.family === 'string') alias.family = record.family;
      alias.ratio ||= record.aspect || record.format;
      alias.context ||= record.context || record.source?.screenshots;
      const { source, ...metadata } = record;
      alias.metadata.push(metadata);
      if (record.inputs && !keys.length) alias.diagnostics.push('Capture checks use the whole recorded browser input set; per-export screenshot keys were not recorded.');
    }
    if (!tracked.length) alias.statuses.push('untracked');
    alias.statuses = [...new Set(alias.statuses)];
    alias.current = isCurrentArtwork(alias.statuses);
    alias.diagnostics = [...new Set(alias.diagnostics)];
    alias.title ||= basename(path, extname(path));
    let item = byHash.get(image.sha256);
    if (!item) {
      item = { id: image.sha256, ...image, imageUrl: `/__artwork/image/${image.sha256}`, aliases: [] };
      byHash.set(image.sha256, item);
    }
    item.aliases.push(alias);
  }
  const items = [...byHash.values()].map((item) => ({ ...item,
    current: item.aliases.some((alias) => alias.current),
    families: [...new Set(item.aliases.map((alias) => alias.family))],
    statuses: [...new Set(item.aliases.flatMap((alias) => alias.statuses))],
  }));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), roots: ARTWORK_ROOTS, caveats: CATALOG_CAVEATS,
    fileCount: items.reduce((sum, item) => sum + item.aliases.length, 0), uniqueCount: items.length,
    diagnostics, items };
}

export function localArtwork({ repoRoot = repository } = {}) {
  let catalog;
  const middleware = async (request, response, next) => {
    const route = request.url?.split('?', 1)[0] || '';
    if (route !== '/__artwork' && !route.startsWith('/__artwork/')) return next();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403); response.end(); return;
    }
    try {
      if (route === '/__artwork/catalog') {
        catalog = await buildArtworkCatalog(repoRoot);
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(catalog));
        return;
      }
      const match = /^\/__artwork\/image\/([a-f0-9]{64})$/.exec(route);
      if (!match) { response.writeHead(404); response.end(); return; }
      catalog ||= await buildArtworkCatalog(repoRoot);
      const item = catalog.items.find((entry) => entry.id === match[1]);
      if (!item) { response.writeHead(404); response.end(); return; }
      const root = await realpath(repoRoot);
      const path = resolve(root, item.aliases[0].path);
      if (!ARTWORK_ROOTS.some((directory) => within(resolve(root, directory), path))) throw new Error('Outside roots');
      const actual = await inspectPng(root, path, true);
      const { handle } = actual;
      if (actual.sha256 !== item.sha256) { await handle.close(); response.writeHead(409); response.end(); return; }
      response.setHeader('Content-Type', 'image/png');
      response.setHeader('Content-Length', actual.bytes);
      if (request.method === 'HEAD') { await handle.close(); response.end(); return; }
      const stream = handle.createReadStream({ start: 0 });
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    }
  };
  return { name: 'sovran-local-artwork', apply: 'serve',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
