/**
 * Promotion: the step between an imported press candidate (app/e2e/artifacts/
 * run-*\/press) and the screenshot library the site and artwork read
 * (press/artwork/source). Only candidates captured on a build-stamped native
 * app are promoted; every promoted entry records its run, capture time and
 * native build so /screenshots can say exactly what it shows. Every entry also
 * records its pixel size: consumers pick a phone body from it, and a capture
 * taken on the wrong device profile has to be visible rather than reframed.
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AppSourceStamp } from '../../../scripts/lib/app-source.mjs';
import { ROOT, type Platform } from './plan';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** PNG IHDR width/height. A registry entry without pixels has no device. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.readUInt32BE(12) !== 0x49484452)
    throw new Error('Candidate is not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The subset of a native build stamp recorded on each promoted capture. */
export type NativeBuildSummary = {
  fingerprint: string;
  appVersion: string;
  buildNumber: string;
  gitSha: string;
  builtAt: string;
  artifactSha256?: string;
};

type RegistryEntry = {
  context: string;
  page: string;
  file: string;
  run: string | null;
  sha256: string | null;
  capturedAt?: string;
  /** Pixel size of the retained capture; consumers pick a device body from it. */
  capture?: { width: number; height: number };
  nativeBuild?: NativeBuildSummary;
  /** App source the capture was taken from; see scripts/lib/app-source.mjs. */
  appSource?: AppSourceStamp;
  availability?: string;
  freshness?: string;
  unavailableReason?: string;
  staleReason?: string;
  lastRefreshFailure?: { at: string; reason: string };
  [field: string]: unknown;
};

/** What promotion reads from a stored entry; curated fields pass through untouched. */
const registrySchema = z.record(
  z.string(),
  z.looseObject({ context: z.string(), page: z.string(), file: z.string() })
);

/** `file` and `key` become read and write paths, so both are single safe path segments. */
const candidateManifestSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9-]+$/),
  platform: z.enum(['ios', 'android']),
  startedAt: z.string(),
  screenshots: z.array(
    z.object({
      file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.png$/),
      key: z.string().regex(/^(ios|android)\/[a-z0-9][a-z0-9-]*$/),
      context: z.string(),
      page: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
  ),
});

export type LibraryPaths = { registry: string; artwork: string };
const LIBRARY: LibraryPaths = {
  registry: join(ROOT, 'press/artwork/source/screenshots.json'),
  artwork: join(ROOT, 'press/artwork'),
};

function readJson<T>(path: string, schema: z.ZodType<T>): { value: T; indent: number } {
  const text = readFileSync(path, 'utf8');
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`Unexpected JSON shape: ${path}`);
  return { value: parsed.data, indent: /^\{\n( +)"/.exec(text)?.[1].length ?? 2 };
}

function writeJsonAtomic(path: string, value: unknown, indent: number) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, indent)}\n`);
  renameSync(temp, path);
}

/** Registry fields that describe a specific capture and must not survive a replacement. */
const CAPTURE_FIELDS = [
  'run',
  'sha256',
  'capture',
  'capturedAt',
  'nativeBuild',
  'appSource',
  'availability',
  'freshness',
  'unavailableReason',
  'staleReason',
  'lastRefreshFailure',
];

/**
 * Copy every candidate PNG into the library and rewrite its registry entry.
 * All candidates are validated before the first byte is written.
 */
export function promoteCandidates(
  pressDirs: string[],
  stamps: {
    builds: Partial<Record<Platform, NativeBuildSummary>>;
    appSource: AppSourceStamp | undefined;
  },
  paths: LibraryPaths = LIBRARY
): string[] {
  const { builds, appSource } = stamps;
  // Without the app source a capture could silently outlive the UI it shows.
  if (!appSource?.fingerprint) throw new Error('No app source stamp; refusing to promote');
  const { value: registry, indent } = readJson(paths.registry, registrySchema);
  const staged: { key: string; bytes: Buffer; destination: string; entry: RegistryEntry }[] = [];
  for (const dir of pressDirs) {
    const { value: manifest } = readJson(join(dir, 'manifest.json'), candidateManifestSchema);
    const build = builds[manifest.platform];
    if (!build)
      throw new Error(`No native build stamp for ${manifest.platform}; refusing to promote ${dir}`);
    for (const shot of manifest.screenshots) {
      const bytes = readFileSync(join(dir, shot.file));
      if (hash(bytes) !== shot.sha256)
        throw new Error(`Candidate hash mismatch: ${dir}/${shot.file}`);
      const file = `source/screenshots/${shot.key}.png`;
      const previous = registry[shot.key];
      if (previous && previous.file !== file)
        throw new Error(`Registry file for ${shot.key} is ${previous.file}, expected ${file}`);
      if (staged.some((item) => item.key === shot.key))
        throw new Error(`Two candidates for ${shot.key}; promote one run per selection`);
      const kept = Object.fromEntries(
        Object.entries(previous ?? {}).filter(([field]) => !CAPTURE_FIELDS.includes(field))
      );
      staged.push({
        key: shot.key,
        bytes,
        destination: join(paths.artwork, file),
        entry: {
          ...kept,
          context: previous?.context ?? shot.context,
          page: previous?.page ?? shot.page,
          file,
          run: `run-${manifest.runId}`,
          sha256: shot.sha256,
          capturedAt: manifest.startedAt,
          capture: pngSize(bytes),
          nativeBuild: build,
          appSource,
        },
      });
    }
  }
  for (const item of staged) {
    mkdirSync(dirname(item.destination), { recursive: true });
    const temp = `${item.destination}.${process.pid}.tmp`;
    writeFileSync(temp, item.bytes);
    renameSync(temp, item.destination);
    if (hash(readFileSync(item.destination)) !== item.entry.sha256)
      throw new Error(`Promoted bytes differ: ${item.key}`);
    registry[item.key] = item.entry;
  }
  writeJsonAtomic(paths.registry, registry, indent);
  return staged.map((item) => item.key);
}

/**
 * Record that a refresh tried and failed to recapture these keys. Display-only:
 * the previous capture stays in use, and the page shows why it was not replaced.
 */
export function recordRefreshFailures(
  failures: { key: string; reason: string }[],
  at: string,
  paths: LibraryPaths = LIBRARY
) {
  if (!failures.length) return;
  const { value: registry, indent } = readJson(paths.registry, registrySchema);
  for (const { key, reason } of failures)
    if (registry[key]) registry[key] = { ...registry[key], lastRefreshFailure: { at, reason } };
  writeJsonAtomic(paths.registry, registry, indent);
}
