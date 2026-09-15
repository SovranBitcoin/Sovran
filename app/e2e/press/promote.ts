/**
 * Promotion: the step between an imported press candidate (app/e2e/artifacts/
 * run-*\/press) and the screenshot library the site and artwork read
 * (press/artwork/source). Only candidates captured on a build-stamped native
 * app are promoted; every promoted entry records its run, capture time and
 * native build so /screenshots can say exactly what it shows.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppSourceStamp } from '../../../scripts/lib/app-source.mjs';
import { ROOT, type Platform } from './plan';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** The subset of a native build stamp recorded on each promoted capture. */
export type NativeBuildSummary = {
  fingerprint: string;
  appVersion: string;
  buildNumber: string;
  gitSha: string;
  builtAt: string;
};

export type RegistryEntry = {
  context: string;
  page: string;
  file: string;
  run: string | null;
  sha256: string | null;
  capturedAt?: string;
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

type CandidateManifest = {
  runId: string;
  platform: Platform;
  startedAt: string;
  screenshots: { file: string; key: string; context: string; page: string; sha256: string }[];
};

export type LibraryPaths = { registry: string; artwork: string; pins: string };
export const LIBRARY: LibraryPaths = {
  registry: join(ROOT, 'press/artwork/source/screenshots.json'),
  artwork: join(ROOT, 'press/artwork'),
  pins: join(ROOT, 'scripts/fixtures/artwork-store-pins.json'),
};

function readJson<T>(path: string): { value: T; indent: number } {
  const text = readFileSync(path, 'utf8');
  return { value: JSON.parse(text) as T, indent: /^\{\n( +)"/.exec(text)?.[1].length ?? 2 };
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
  const { value: registry, indent } = readJson<Record<string, RegistryEntry>>(paths.registry);
  const staged: { key: string; bytes: Buffer; destination: string; entry: RegistryEntry }[] = [];
  for (const dir of pressDirs) {
    const manifest = JSON.parse(
      readFileSync(join(dir, 'manifest.json'), 'utf8')
    ) as CandidateManifest;
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
  syncStorePins(registry, paths.pins);
  return staged.map((item) => item.key);
}

/** The artwork store pins mirror the retained store captures; keep them in lockstep. */
function syncStorePins(registry: Record<string, RegistryEntry>, pinsPath: string) {
  if (!existsSync(pinsPath)) return;
  const { value: pins, indent } =
    readJson<Record<string, { run: string; screenshots: { file: string; sha256: string }[] }>>(
      pinsPath
    );
  let changed = false;
  for (const [platform, data] of Object.entries(pins)) {
    const entries = data.screenshots.map((source) => {
      const name = source.file.split('/').at(-1)!.replace('.png', '').replace('ai-chat', 'ai');
      return registry[`${platform}/${name}`];
    });
    const runs = new Set(entries.map((entry) => entry?.run));
    // Only move the pins when the whole store set comes from one promoted run.
    if (
      runs.size !== 1 ||
      !entries[0]?.run ||
      !entries.every((entry) => entry?.nativeBuild && entry.appSource)
    )
      continue;
    const run = entries[0].run;
    if (
      data.run === run &&
      data.screenshots.every((source, i) => source.sha256 === entries[i]!.sha256)
    )
      continue;
    data.run = run;
    data.screenshots.forEach((source, i) => (source.sha256 = entries[i]!.sha256!));
    changed = true;
  }
  if (changed) writeJsonAtomic(pinsPath, pins, indent);
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
  const { value: registry, indent } = readJson<Record<string, RegistryEntry>>(paths.registry);
  for (const { key, reason } of failures)
    if (registry[key]) registry[key] = { ...registry[key], lastRefreshFailure: { at, reason } };
  writeJsonAtomic(paths.registry, registry, indent);
}
