import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { appSourceFingerprint, classifyCapture } from '../../scripts/lib/app-source.mjs';
import { captureDevice, FRAME_IDS, SCENE_PRESETS, CANVAS_FORMATS } from '../../scripts/lib/phone-frame.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const logicalId = /^(ios|android)\/[a-z0-9-]+$/;
const maxBytes = 24 * 1024 * 1024;
const list = value => Array.isArray(value) ? value : [];
const name = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const slotId = entry => entry && ['ios', 'android'].includes(entry.platform) && name(entry.page) && name(entry.state)
  ? `${entry.platform}/${entry.page}${entry.state === 'default' ? '' : `--${entry.state}`}` : undefined;

// Mirrors the importer's public capture-record contract, without importing its
// native drivers, loader, or raster dependencies into the static site config.
function approvedLibraryRecord(record) {
  const id = slotId(record), profile = record?.captureProfile;
  const stamp = record?.appSource, native = record?.nativeBuild;
  const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  const gitSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  return Boolean(id && record.file === `${id}.png` && record.status === 'verified' &&
    ['native-fixture', 'native-navigation'].includes(record.evidenceClass) &&
    record.functionalResult === 'not-established' && record.publicationEligibility === 'eligible' &&
    ['public-fixture', 'disposable-profile'].includes(record.privacy) &&
    typeof record.scenario === 'string' && /^[a-z][a-z0-9.-]*$/.test(record.scenario) &&
    Number.isInteger(record.occurrence) && record.occurrence > 0 && /^[PTVC][0-9]+$/.test(record.stepId) &&
    typeof record.runId === 'string' && /^[a-zA-Z0-9-]+$/.test(record.runId) && date(record.capturedAt) &&
    ['sourceFingerprint', 'recipeSha256', 'manifestSha256', 'eventsSha256', 'originalSha256', 'sha256', 'sessionSha256'].every(key => digest(record[key])) &&
    digest(stamp?.fingerprint) && gitSha(stamp?.gitSha) && typeof stamp?.gitDirty === 'boolean' &&
    /^[a-f0-9]{40,64}$/.test(native?.fingerprint) && digest(native?.artifactSha256) && /^[0-9.]+$/.test(native?.appVersion) && /^[0-9]+$/.test(native?.buildNumber) && gitSha(native?.gitSha) && date(native?.builtAt) &&
    profile?.profile === 'library-v1' && profile.locale === 'en-US' && profile.appearance === 'light' && profile.fontScale === 1 &&
    typeof profile.runtime === 'string' && profile.runtime.length > 0 &&
    profile.resolution?.width === record.width && profile.resolution?.height === record.height &&
    (record.platform === 'ios'
      ? record.width === 1320 && record.height === 2868 && profile.model === 'iPhone 17 Pro Max' && profile.runtime === '26.2' && profile.density?.scale === 3
      : record.width === 1080 && record.height === 2400 && typeof profile.model === 'string' && profile.model.length > 0 && profile.systemImage === 'system-images/android-36.1/google_apis_playstore/arm64-v8a' && profile.density?.dpi === 420));
}

// Metadata selects assets, never a request path. Reject symlinks at every level,
// then read and hash the same open descriptor used by the renderer/HTTP response.
export async function readSourceFile(repoRoot, file) {
  const root = await realpath(repoRoot);
  if (typeof file !== 'string' || file.startsWith('/') || file.includes('\\') ||
      file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid asset path');
  const path = resolve(root, file);
  if (!path.startsWith(root + sep)) throw new Error('Outside asset root');
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink asset');
  }
  if (await realpath(path) !== path) throw new Error('Redirected asset');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Asset too large or not a file');
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error('Asset too large');
    return bytes;
  } finally { await handle.close(); }
}

// Recheck serving authority as well as bytes: a cached opaque URL must stop
// working after a capture is withdrawn or its privacy/provenance is changed.
export async function readCaptureSource(repoRoot, source) {
  if (source.source === 'library') {
    const manifest = JSON.parse((await readSourceFile(repoRoot, 'press/screenshots/manifest.json')).toString());
    const matches = list(manifest.captures).filter(record => slotId(record) === source.id);
    if (manifest.version !== 1 || matches.length !== 1 || !approvedLibraryRecord(matches[0]) ||
        source.file !== `press/screenshots/${matches[0].file}` || sha256(JSON.stringify(matches[0])) !== source.recordSha256)
      throw new Error('Library capture approval changed. Refresh sources.');
  } else {
    const registry = JSON.parse((await readSourceFile(repoRoot, 'press/artwork/source/screenshots.json')).toString());
    const entry = registry[source.registryId ?? source.id];
    if (!entry?.run || entry.sha256 !== source.sha256 || entry.availability === 'unavailable' || entry.freshness === 'stale' ||
        source.file !== `press/artwork/source/screenshots/${source.registryId ?? source.id}.png` || `press/artwork/${entry.file}` !== source.file)
      throw new Error('Press capture approval changed. Refresh sources.');
  }
  try {
    const inventory = JSON.parse((await readSourceFile(repoRoot, 'press/screenshots/inventory.json')).toString());
    if (list(inventory.targets).some(target => slotId(target) === source.id && target.privacy === 'blocked'))
      throw new Error('Capture privacy is blocked.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = await readSourceFile(repoRoot, source.file);
  if (sha256(bytes) !== source.sha256) throw new Error('Capture bytes changed. Refresh sources.');
  return bytes;
}

export async function buildSourceCatalog(repoRoot) {
  const diagnostics = [];
  const json = async (file, optional = false) => {
    try {
      const value = JSON.parse((await readSourceFile(repoRoot, file)).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected metadata object');
      return value;
    }
    catch (error) {
      if (!optional || error.code !== 'ENOENT') diagnostics.push(`Metadata unavailable: ${file}`);
      return {};
    }
  };
  const registry = await json('press/artwork/source/screenshots.json');
  const contexts = await json('press/artwork/source/screenshot-context.json');
  const coverage = await json('press/screenshots/manifest.json', true);
  const inventory = await json('press/screenshots/inventory.json', true);
  const fingerprint = appSourceFingerprint(repoRoot);
  let pages = [];
  try {
    const source = (await readSourceFile(repoRoot, 'app/e2e/schema/pages.ts')).toString();
    const array = source.match(/export const CANONICAL_PAGES = \[([\s\S]*?)\] as const;/)?.[1];
    if (!array) throw new Error('Canonical page registry unavailable');
    pages = [...array.matchAll(/^\s*'([a-z][a-z0-9-]*)',/gm)].map(match => match[1]);
  } catch (error) { if (error.code !== 'ENOENT') diagnostics.push('Canonical page registry unavailable.'); }
  const plans = new Map();
  for (const [document, targets] of [['press/screenshots/manifest.json', coverage.version === 1 ? list(coverage.inventory) : []],
    ['press/screenshots/inventory.json', inventory.version === 1 ? list(inventory.targets) : []]]) {
    for (const target of targets) {
      const id = slotId(target);
      if (id && (!pages.length || pages.includes(target.page))) plans.set(id, { ...target, source: document });
    }
  }
  // All canonical baseline slots exist even before the campaign's first image.
  // Without inventory, do not invent plan approval or execute the native planner.
  for (const platform of ['ios', 'android']) for (const page of pages) {
    const id = `${platform}/${page}`;
    if (!plans.has(id)) plans.set(id, { platform, page, state: 'default', baseline: true, status: 'blocked',
      blocker: 'Capture plan unavailable. Write press/screenshots/inventory.json before capture runs.', source: 'app/e2e/schema/pages.ts' });
  }
  const expected = new Map();
  for (const collection of list(contexts.collections)) for (const key of list(collection?.screenshots))
    if (logicalId.test(key)) expected.set(key, {});
  for (const [key, entry] of Object.entries(registry)) if (logicalId.test(key)) expected.set(key, { ...expected.get(key), ...entry });
  // Always show the other platform, even before its first capture attempt.
  for (const key of [...expected.keys()]) for (const platform of ['ios', 'android']) {
    const paired = `${platform}/${key.split('/')[1]}`;
    if (!expected.has(paired)) expected.set(paired, { context: expected.get(key)?.context, page: expected.get(key)?.page });
  }
  const slots = new Map([...plans].map(([id, plan]) => [id, { plan, aliases: [], press: [] }]));
  for (const [key, entry] of expected) {
    const [platform, slug] = key.split('/');
    const context = contexts.contexts?.[entry.context ?? slug] ?? {};
    const page = entry.page ?? context.page ?? slug;
    const state = slug.startsWith(`${page}-`) ? slug.slice(page.length + 1) : 'default';
    // Only map a variant when the plan or explicit registry metadata identifies
    // its page/state. Unknown press aliases stay distinct, never become defaults.
    const canonical = slotId({ platform, page, state });
    const id = canonical && (plans.has(canonical) || slug === page || slug.startsWith(`${page}-`)) ? canonical : key;
    if (!slots.has(id)) slots.set(id, { aliases: [], press: [] });
    const slot = slots.get(id);
    if (key !== id) slot.aliases.push(key);
    slot.context ??= context;
    slot.press.push({ ...entry, registryId: key });
  }
  for (const record of coverage.version === 1 ? list(coverage.captures) : []) {
    const id = slotId(record);
    if (!id || !pages.includes(record.page)) { diagnostics.push('Excluded library record with unknown canonical identity.'); continue; }
    if (!slots.has(id)) slots.set(id, { aliases: [], press: [] });
    const slot = slots.get(id);
    if (slot.library) { slot.duplicate = true; diagnostics.push(`Duplicate library capture: ${id}`); }
    slot.library = record;
  }
  const captures = [];
  for (const [id, slot] of slots) {
    const platform = id.split('/')[0];
    const plan = slot.plan;
    const context = slot.context ?? contexts.contexts?.[id.split('/')[1]] ?? {};
    const library = slot.library;
    const validLibrary = library && !slot.duplicate && approvedLibraryRecord(library);
    // A selected library record that fails integrity is not silently replaced by
    // a press image. Its slot remains visible with the precise failure reason.
    const entry = library ? { ...library, run: library.runId } : slot.press.find(entry => entry.run && entry.sha256) ?? slot.press[0] ?? {};
    const stateId = plan?.state ?? library?.state ?? id.split('--')[1] ?? 'default';
    const page = plan?.page ?? library?.page ?? context.page ?? entry.page ?? id.split('/')[1];
    const blocked = plan?.privacy === 'blocked' || (library && !validLibrary);
    const capture = { id, aliases: slot.aliases, platform, page, stateId, baseline: Boolean(plan?.baseline),
      title: context.caption ?? page, state: context.state ?? stateId,
      context, source: library ? 'library' : 'press', registryId: entry.registryId,
      capturedAt: entry.capturedAt, run: entry.run, nativeBuild: entry.nativeBuild,
      appSource: entry.appSource, lastRefreshFailure: entry.lastRefreshFailure,
      captureProfile: library?.captureProfile, evidenceClass: library?.evidenceClass ?? 'press-curated',
      captureEvidence: validLibrary ? Object.fromEntries(['scenario', 'occurrence', 'stepId', 'sourceFingerprint', 'recipeSha256', 'manifestSha256', 'eventsSha256', 'originalSha256', 'sessionSha256'].map(key => [key, library[key]])) : undefined,
      functionalResult: 'not-established', publicationEligibility: validLibrary ? 'eligible' : 'not-established', publicationReview: 'not-established',
      privacy: library?.privacy, recordSha256: validLibrary ? sha256(JSON.stringify(library)) : undefined,
      plan, latestAttempt: plan?.latestAttempt ?? plan?.lastAttempt ?? entry.lastRefreshFailure ?? null,
      attemptStatus: plan?.status ?? (entry.lastRefreshFailure ? 'failed' : entry.run ? 'captured' : 'notattempted'),
      blocker: plan?.blocker ?? (plan?.status === 'blocked' ? plan?.reason : undefined), attemptReason: plan?.reason,
      freshness: !entry.run && !entry.sha256 ? (entry.lastRefreshFailure ? 'missing' : 'notattempted') : classifyCapture(entry, fingerprint),
      reason: entry.unavailableReason ?? entry.staleReason ?? '', available: false };
    if (blocked) {
      if (library || entry.run) capture.freshness = 'withdrawn';
      capture.reason = plan?.privacy === 'blocked' ? 'Capture privacy is blocked by the inventory.' : 'Library record is not approved or has incomplete provenance.';
    }
    if (!['withdrawn', 'notattempted', 'missing'].includes(capture.freshness)) {
      try {
        if (!library && entry.file !== `source/screenshots/${entry.registryId}.png`) throw new Error('Unapproved capture path');
        const file = library ? `press/screenshots/${entry.file}` : `press/artwork/${entry.file}`;
        const bytes = await readSourceFile(repoRoot, file);
        if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Not a PNG');
        const hash = sha256(bytes);
        if (hash !== entry.sha256) throw new Error('Capture bytes do not match the registered hash');
        const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
        if (library && (width !== library.width || height !== library.height)) throw new Error('Library image dimensions do not match the manifest');
        if (width * height > 20_000_000) throw new Error('Capture exceeds pixel limit');
        const device = captureDevice(platform, width, height);
        Object.assign(capture, { available: true, file, sha256: hash, width, height, frameId: device.id,
          imageUrl: `/__artwork/image/${hash}`, bytes: bytes.length });
      } catch (error) { capture.freshness = 'missing'; capture.reason = error.code === 'ENOENT' ? 'Registered image is missing.' : error.message; }
    }
    captures.push(capture);
  }
  captures.sort((a, b) => a.page.localeCompare(b.page) || a.id.localeCompare(b.id));

  const manifest = await json('app/assets/brand/generated/manifest.json', true);
  const brandConfig = await json('app/assets/brand/source/brand.json', true);
  let brandCurrent = Boolean(manifest.sources);
  for (const [key, file] of Object.entries({ mark: 'app/assets/brand/source/symbol.svg', wordmark: 'app/assets/brand/source/wordmark.svg', config: 'app/assets/brand/source/brand.json', font: brandConfig.versionFont })) {
    try { if (sha256(await readSourceFile(repoRoot, file)) !== manifest.sources?.[key]) brandCurrent = false; }
    catch { brandCurrent = false; }
  }
  const app = await json('app/app.json', true);
  const logos = [];
  for (const variant of [...list(manifest.variants), ...(manifest.androidAdaptive ? [{ ...manifest.androidAdaptive, layout: 'android-adaptive-icon', theme: 'black-on-transparent' }] : [])].filter(Boolean)) {
    // viewBox and ink bounds travel with the logo so a consumer can place the
    // lockup by its ink, not by its padded canvas.
    const box = list(variant.viewBox).filter(value => Number.isFinite(value));
    const bounds = list(variant.bounds).filter(bound => bound && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bound[key])))
      .map(bound => ({ role: typeof bound.role === 'string' ? bound.role : 'ink', x: bound.x, y: bound.y, width: bound.width, height: bound.height }));
    const logo = { id: `${variant.layout}/${variant.theme}`, layout: variant.layout, theme: variant.theme,
      ...(box.length === 4 ? { viewBox: box } : {}), ...(bounds.length ? { bounds } : {}), outputs: [] };
    const current = brandCurrent && (variant.layout !== 'version-lockup' || app.expo?.version === manifest.productVersion);
    for (const output of [...(variant.svg ? [{ file: variant.svg, format: 'svg' }] : []), ...list(variant.pngs).map(png => ({ ...png, format: 'png' }))]) {
      try {
        if (!/^generated\/[a-z0-9-]+\/[a-z0-9-]+\/(artwork\.svg|\d+x\d+\.png)$/.test(output.file)) throw new Error('Unapproved logo');
        const file = `app/assets/brand/${output.file}`;
        const bytes = await readSourceFile(repoRoot, file), hash = sha256(bytes);
        if (output.sha256 && hash !== output.sha256) throw new Error('Logo hash mismatch');
        if (output.format === 'svg' && (!/<svg\b/.test(bytes.toString()) || /<script\b|<foreignObject\b|<style\b|@import|url\(\s*(?!#)|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#)|<!DOCTYPE|<!ENTITY/i.test(bytes.toString()))) throw new Error('Unsafe SVG');
        logo.outputs.push({ ...output, file, sha256: hash, imageUrl: `/__artwork/image/${hash}`, bytes: bytes.length,
          freshness: current ? (output.sha256 ? 'current-render' : 'source-matched-output-unverified') : 'stale-render' });
      } catch { diagnostics.push(`Logo unavailable: ${output.file}`); }
    }
    logos.push(logo);
  }
  const copy = await json('press/artwork/source/copy.json', true);
  const concepts = [];
  try {
    const directory = 'press/artwork/source/concepts';
    if ((await lstat(resolve(repoRoot, directory))).isSymbolicLink()) throw new Error('Symlink concepts');
    for (const file of (await readdir(resolve(repoRoot, directory))).sort()) {
      if (!/^[a-z0-9-]+\.json$/.test(file)) continue;
      const concept = await json(`${directory}/${file}`);
      const wording = copy.concepts?.[concept.copy] ?? {};
      const keys = list(concept.screenshots).filter(key => typeof key === 'string').map(key => key.includes('/') ? key : `${concept.platform ?? 'ios'}/${key}`).filter(key => captures.some(capture => capture.id === key || capture.aliases.includes(key)));
      // Add only metadata-related captures; never unrelated or repeated slot fillers.
      const related = captures.filter(capture => capture.platform === (concept.platform ?? 'ios') && keys.some(key => {
        const source = captures.find(item => item.id === key || item.aliases.includes(key));
        return source?.context.relatedPages?.includes(capture.page) || (source?.context.flow?.id && source.context.flow.id === capture.context.flow?.id);
      })).map(capture => capture.id);
      const seen = new Set();
      const captureIds = [...keys, ...related].filter(key => {
        const capture = captures.find(item => item.id === key || item.aliases.includes(key));
        if (!capture || seen.has(capture.id)) return false;
        seen.add(capture.id); return true;
      });
      concepts.push({ id: concept.id, title: concept.id.replaceAll('-', ' '),
        headline: wording.headlines?.[wording.chosen?.headline ?? 0] ?? '',
        subtitle: wording.subtitles?.[wording.chosen?.subtitle ?? 0] ?? '',
        captureIds: captureIds.slice(0, 4) });
    }
  } catch { diagnostics.push('Concept catalog unavailable.'); }
  return { version: 1, generatedAt: new Date().toISOString(), fingerprint, captures, logos, concepts,
    frames: FRAME_IDS, presets: SCENE_PRESETS, formats: CANVAS_FORMATS, diagnostics,
    coverage: { available: inventory.version === 1 || coverage.version === 1, entries: plans.size,
      baselineDenominator: pages.length * 2, baselineSlots: captures.filter(capture => capture.baseline).length,
      inventorySource: inventory.version === 1 ? 'press/screenshots/inventory.json' : coverage.version === 1 ? 'press/screenshots/manifest.json' : 'app/e2e/schema/pages.ts',
      campaign: inventory.campaign },
    caveat: 'Native fixture and navigation captures do not establish functional results. Import eligibility is not publication review. App-source freshness does not prove current native build freshness.' };
}
