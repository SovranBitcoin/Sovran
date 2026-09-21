import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { createCapturePlan, ROOT, type CapturePlan } from './plan';
import { CANONICAL_PAGES } from '../schema/pages';
import { LIBRARY_CAPTURE_PROFILE, assertCaptureResolution } from '../drivers/capture-profile';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stamp = z.object({
  fingerprint: digest,
  gitSha: z.string().regex(/^[a-f0-9]{40}$/),
  gitDirty: z.boolean(),
});
const nativeStamp = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{40,64}$/),
  appVersion: z.string().regex(/^[0-9.]+$/),
  buildNumber: z.string().regex(/^[0-9]+$/),
  gitSha: z.string().regex(/^[a-f0-9]{40}$/),
  builtAt: z.iso.datetime(),
  artifactSha256: digest,
});
const captureMetadata = z.object({
  profile: z.literal('library-v1'),
  model: z.string(),
  runtime: z.string(),
  runtimeBuild: z.string().optional(),
  systemImage: z.string().optional(),
  resolution: z.object({ width: z.number(), height: z.number() }),
  density: z.object({ dpi: z.number().optional(), scale: z.number().optional() }),
  locale: z.literal('en-US'),
  appearance: z.literal('light'),
  fontScale: z.literal(1),
  motion: z.literal('reduced').optional(),
});
export const captureRecord = z.object({
  platform: z.enum(['ios', 'android']),
  page: z.enum(CANONICAL_PAGES),
  state: z.string().regex(/^[a-z][a-z0-9-]*$/),
  file: z.string().regex(/^(ios|android)\/[a-z][a-z0-9-]*\.png$/),
  evidenceClass: z.enum(['native-fixture', 'native-navigation']),
  functionalResult: z.literal('not-established'),
  privacy: z.enum(['public-fixture', 'disposable-profile']),
  publicationEligibility: z.literal('eligible'),
  status: z.literal('verified'),
  scenario: z.string().regex(/^[a-z][a-z0-9.-]*$/),
  occurrence: z.number().int().positive(),
  stepId: z.string().regex(/^[PTVC][0-9]+$/),
  runId: z.string().regex(/^[a-zA-Z0-9-]+$/),
  capturedAt: z.iso.datetime(),
  sourceFingerprint: digest,
  appSource: stamp,
  nativeBuild: nativeStamp,
  recipeSha256: digest,
  manifestSha256: digest,
  eventsSha256: digest,
  originalSha256: digest,
  sha256: digest,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sessionSha256: digest,
  captureProfile: captureMetadata,
});
const attestation = z.object({
  sourceFingerprint: digest,
  appSourceBefore: stamp,
  appSourceAfter: stamp,
  nativeBuild: nativeStamp,
  nativeFingerprintBefore: z.string(),
  nativeFingerprintAfter: z.string(),
});
export type CaptureAttestation = z.infer<typeof attestation>;
const manifestSchema = z.object({
  version: z.literal(1),
  runId: z.string().regex(/^[a-zA-Z0-9-]+$/),
  suite: z.string(),
  driver: z.enum(['sim', 'android']),
  proof: z.literal('product-run'),
  sourceFingerprint: digest,
  recording: z.literal(false),
  evidence: z.literal('screenshots'),
  startedAt: z.iso.datetime(),
  scenarios: z.array(z.string()).length(1),
  filters: z.object({ scenario: z.string() }),
  funded: z.never().optional(),
});
const eventSchema = z
  .object({ type: z.string(), seq: z.number().int().nonnegative(), t: z.number().finite() })
  .catchall(z.unknown());
type Event = z.infer<typeof eventSchema>;

function contained(root: string, file: string) {
  const path = realpathSync(resolve(root, file));
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !statSync(path).isFile())
    throw new Error('Evidence path escapes run');
  return path;
}
function exactly(events: Event[], type: string, predicate: (event: Event) => boolean = () => true) {
  const found = events.filter((e) => e.type === type && predicate(e));
  if (found.length !== 1) throw new Error(`Expected exactly one ${type} event`);
  return found[0];
}

interface CaptureImportOptions {
  /** Captured by the trusted refresh caller around this exact run, never guessed from current HEAD. */
  attestation: CaptureAttestation;
  plan?: CapturePlan;
  /** Defaults to the new library; never the press artwork curator. */
  libraryDir?: string;
}

/** Imports one explicitly selected, complete native run. No device execution.
 * Caller serializes imports. Original evidence is immutable; only decoded,
 * metadata-stripped PNGs and whitelisted provenance leave the run directory. */
export async function importCaptureRun(runDir: string, options: CaptureImportOptions) {
  const plan = options.plan ?? createCapturePlan();
  const proof = attestation.parse(options.attestation);
  if (
    proof.appSourceBefore.fingerprint !== proof.appSourceAfter.fingerprint ||
    proof.nativeFingerprintBefore !== proof.nativeBuild.fingerprint ||
    proof.nativeFingerprintAfter !== proof.nativeBuild.fingerprint
  )
    throw new Error('Source/build changed or is unverified');
  const root = realpathSync(runDir);
  const manifestBytes = readFileSync(contained(root, 'manifest.json'));
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString()));
  if (manifest.sourceFingerprint !== proof.sourceFingerprint)
    throw new Error('Run source fingerprint mismatch');
  const platform = manifest.driver === 'sim' ? 'ios' : 'android';
  const invocation = plan.invocations.find(
    (i) =>
      i.platform === platform &&
      i.suite === manifest.suite &&
      i.scenario === manifest.filters.scenario &&
      i.scenario === manifest.scenarios[0]
  );
  if (!invocation) throw new Error('Run is not an exact safe recipe selection');
  const approvedPlan = createCapturePlan([platform]);
  const approved = approvedPlan.invocations.find(
    (i) => i.scenario === invocation.scenario && i.suite === invocation.suite
  );
  if (
    !approved ||
    approved.recipeSha256 !== invocation.recipeSha256 ||
    JSON.stringify(approved.scenarios) !== JSON.stringify(invocation.scenarios)
  )
    throw new Error('Recipe changed since planning or was not reviewed');
  const scenario = invocation.scenarios[0];
  const sessionFiles = readdirSync(root).filter((name) => /^session-\d+\.json$/.test(name));
  if (sessionFiles.length !== 1 || sessionFiles[0] !== 'session-1.json')
    throw new Error('Expected one attributed native session');
  const sessionBytes = readFileSync(contained(root, sessionFiles[0]));
  const session = z
    .object({
      version: z.literal(1),
      runId: z.string(),
      parentRunId: z.string(),
      ephemeral: z.literal(true),
      seedExport: z.literal(false),
      scenarios: z.array(z.string()).length(1),
      captureProfile: z.literal('library-v1'),
      capture: captureMetadata,
      simulator: z.object({ deviceType: z.string(), runtimeVersion: z.string() }).optional(),
      android: z.object({ serial: z.string().regex(/^emulator-\d+$/) }).optional(),
    })
    .parse(JSON.parse(sessionBytes.toString()));
  const expectedProfile = LIBRARY_CAPTURE_PROFILE[platform];
  if (
    session.runId !== `${manifest.runId}-01` ||
    session.parentRunId !== manifest.runId ||
    session.scenarios[0] !== scenario.id ||
    (platform === 'ios'
      ? session.capture.model !== expectedProfile.model ||
        !session.simulator ||
        !!session.android ||
        session.capture.runtime !== LIBRARY_CAPTURE_PROFILE.ios.runtime ||
        session.capture.density.scale !== 3
      : !session.android ||
        !!session.simulator ||
        session.capture.systemImage !== LIBRARY_CAPTURE_PROFILE.android.systemImage ||
        session.capture.density.dpi !== 420)
  )
    throw new Error('Native session/profile attribution mismatch');
  assertCaptureResolution(platform, session.capture.resolution);
  const eventsBytes = readFileSync(contained(root, 'events.jsonl'));
  const events = eventsBytes
    .toString()
    .trim()
    .split('\n')
    .map((line) => eventSchema.parse(JSON.parse(line)));
  if (
    events.some(
      (e, i) =>
        e.seq !== i ||
        e.ok === false ||
        e.skipped === true ||
        e.error ||
        [
          'skip',
          'deferred',
          'cleanup.skipped',
          'funding',
          'quarantine',
          'baseline.failure',
        ].includes(e.type)
    )
  )
    throw new Error('Incomplete or failed evidence');
  const first = exactly(events, 'run.begin');
  const last = exactly(events, 'run.end');
  if (
    first !== events[0] ||
    last !== events.at(-1) ||
    first.runId !== manifest.runId ||
    last.runId !== manifest.runId ||
    first.proof !== 'product-run' ||
    last.proof !== 'product-run' ||
    first.suite !== manifest.suite ||
    first.totalScenarios !== 1 ||
    last.passed !== 1 ||
    last.failed !== 0 ||
    last.skipped !== 0 ||
    last.deferred !== 0 ||
    last.funds !== 'n/a'
  )
    throw new Error('Run did not complete successfully');
  const begin = exactly(events, 'scenario.begin');
  const end = exactly(events, 'scenario.end');
  if (
    begin.id !== scenario.id ||
    begin.lane !== 'simulator' ||
    end.id !== scenario.id ||
    end.ok !== true ||
    begin.seq >= end.seq
  )
    throw new Error('Scenario interval mismatch');
  const segment = events.slice(begin.seq + 1, end.seq);
  // The invariant is "the scenario's DECLARED cleanup ran, and the final state
  // is the declared one" — not "a cleanup phase exists". A scenario authored
  // with no cleanup steps (capture.onboarding) emits no cleanup phase at all,
  // and demanding one disqualified it however cleanly it ran. Undeclared
  // cleanup evidence is still a mismatch and still fails.
  const declaresCleanup = scenario.steps.some((step) => step.phase === 'cleanup');
  const final = exactly(segment, 'final-state');
  if (
    final.ok !== true ||
    final.actual !== scenario.endState ||
    final.expected !== scenario.endState
  )
    throw new Error('Cleanup/final state unverified');
  if (declaresCleanup) {
    const cleanup = exactly(segment, 'cleanup.end');
    if (cleanup.ok !== true || cleanup.seq >= final.seq)
      throw new Error('Cleanup/final state unverified');
  } else if (segment.some((event) => event.type === 'cleanup.end'))
    throw new Error('Cleanup evidence for a scenario that declares no cleanup');
  const starts = segment.filter((e) => e.type === 'step.begin' || e.type === 'assertion.begin');
  const ends = segment.filter((e) => e.type === 'step.end' || e.type === 'assertion.end');
  if (starts.length !== scenario.steps.length || ends.length !== scenario.steps.length)
    throw new Error('Incomplete authored step evidence');
  for (const [i, step] of scenario.steps.entries()) {
    if (
      starts[i].stepId !== step.id ||
      ends[i].stepId !== step.id ||
      (starts[i].type === 'assertion.begin' ? 'assert' : starts[i].kind) !== step.action ||
      (ends[i].type === 'assertion.end' ? 'assert' : ends[i].kind) !== step.action ||
      ends[i].ok !== true ||
      starts[i].seq >= ends[i].seq ||
      (i > 0 && ends[i - 1].seq >= starts[i].seq)
    )
      throw new Error('Step order or completion mismatch');
  }
  const artifacts = segment.filter(
    (e) =>
      e.type === 'artifact' &&
      e.kind === 'screenshot' &&
      typeof e.path === 'string' &&
      e.path.includes('/named/')
  );
  if (artifacts.length !== scenario.captures.length) throw new Error('Incomplete named captures');
  const selected = approvedPlan.targets.filter(
    (t) =>
      t.platform === platform &&
      t.scenario === scenario.id &&
      t.status === 'planned' &&
      t.publicationEligibility === 'eligible-after-verification'
  );
  const images = [];
  for (const [i, capture] of scenario.captures.entries()) {
    const artifact = artifacts[i];
    if (
      artifact.stepId !== capture.stepId ||
      typeof artifact.path !== 'string' ||
      !Number.isSafeInteger(artifact.artifactSeq) ||
      Number(artifact.artifactSeq) < 1
    )
      throw new Error('Capture attribution mismatch');
    const expected = `${scenario.id}/named/${capture.page}-${String(artifact.artifactSeq).padStart(3, '0')}.png`;
    const path = contained(root, artifact.path);
    if (relative(root, path) !== expected) throw new Error('Capture path mismatch');
    const start = exactly(segment, 'step.begin', (e) => e.stepId === capture.stepId);
    const finish = exactly(segment, 'step.end', (e) => e.stepId === capture.stepId);
    if (artifact.seq <= start.seq || artifact.seq >= finish.seq)
      throw new Error('Capture outside screenshot step');
    const target = selected.find(
      (t) => t.page === capture.page && t.occurrence === capture.occurrence
    );
    if (!target) continue; // Never promote incidental or privacy-blocked screenshots.
    if (!target.readinessStepIds.length) throw new Error('No page readiness evidence');
    for (const stepId of target.readinessStepIds) {
      const ready = ends.find((e) => e.stepId === stepId);
      if (!ready || ready.ok !== true || ready.seq >= start.seq)
        throw new Error('Page was not ready before capture');
    }
    const original = readFileSync(path);
    if (!original.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('PNG required');
    const image = sharp(original, { failOn: 'warning', limitInputPixels: 40_000_000 });
    const { width, height, format } = await image.metadata();
    if (format !== 'png' || !width || !height || width >= height || width < 1080 || height < 1920)
      throw new Error('Unsupported native portrait dimensions');
    assertCaptureResolution(platform, { width, height });
    const stats = await image.stats();
    if (stats.channels.slice(0, 3).every((c) => c.max - c.min < 2))
      throw new Error('Blank or fully redacted frame is not page evidence');
    const bytes = await image.png().toBuffer();
    images.push({
      target,
      bytes,
      record: captureRecord.parse({
        platform,
        page: target.page,
        state: target.state,
        file: `${platform}/${target.page}${target.state === 'default' ? '' : `--${target.state}`}.png`,
        evidenceClass: target.evidenceClass,
        functionalResult: 'not-established' as const,
        privacy: target.privacy,
        publicationEligibility: 'eligible' as const,
        status: 'verified' as const,
        scenario: scenario.id,
        occurrence: target.occurrence,
        stepId: capture.stepId,
        runId: manifest.runId,
        capturedAt: new Date(artifact.t).toISOString(),
        sourceFingerprint: manifest.sourceFingerprint,
        appSource: proof.appSourceBefore,
        nativeBuild: proof.nativeBuild,
        recipeSha256: invocation.recipeSha256,
        manifestSha256: sha(manifestBytes),
        eventsSha256: sha(eventsBytes),
        originalSha256: sha(original),
        sha256: sha(bytes),
        width,
        height,
        sessionSha256: sha(sessionBytes),
        captureProfile: session.capture,
      }),
    });
  }
  if (!images.length) throw new Error('No eligible captures');
  const library = resolve(options.libraryDir ?? join(ROOT, 'press/screenshots'));
  await mkdir(library, { recursive: true });
  // Lock before reading the previous manifest; overlapping refreshes must not lose updates.
  const lock = join(library, '.import-lock');
  await mkdir(lock);
  let stage: string | undefined;
  try {
    const manifestPath = join(library, 'manifest.json');
    const previous = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : { version: 1, captures: [] };
    if (previous.version !== 1 || !Array.isArray(previous.captures))
      throw new Error('Invalid library manifest');
    const records = new Map<string, (typeof images)[number]['record']>();
    for (const raw of previous.captures) {
      const record = captureRecord.parse(raw);
      const expected = `${record.platform}/${record.page}${record.state === 'default' ? '' : `--${record.state}`}.png`;
      if (
        record.file !== expected ||
        sha(readFileSync(contained(realpathSync(library), record.file))) !== record.sha256
      )
        throw new Error('Previous capture integrity mismatch');
      records.set(record.file, record);
    }
    const updates = images.filter(({ record }) => {
      const prior = records.get(record.file);
      return !prior || Date.parse(prior.capturedAt) <= Date.parse(record.capturedAt);
    });
    stage = await mkdtemp(join(library, '.staging-'));
    for (const { bytes, record } of updates) {
      const staged = join(stage, record.file);
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, bytes, { mode: 0o600, flag: 'wx' });
      records.set(record.file, record);
    }
    const inventory = createCapturePlan(['ios', 'android']).targets.map((target) => {
      const file = `${target.platform}/${target.page}${target.state === 'default' ? '' : `--${target.state}`}.png`;
      const record = records.get(file);
      const current = record?.appSource.fingerprint === proof.appSourceAfter.fingerprint;
      return {
        ...target,
        status:
          record && target.status === 'planned' ? (current ? 'verified' : 'stale') : target.status,
        capture: record?.file ?? null,
      };
    });
    await writeFile(
      join(stage, 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          baselineDenominator: inventory.filter((t) => t.baseline).length,
          inventory,
          captures: [...records.values()],
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    );
    for (const { record } of updates) {
      await mkdir(join(library, platform), { recursive: true });
      await rename(join(stage, record.file), join(library, record.file));
    }
    await rename(join(stage, 'manifest.json'), manifestPath);
    return {
      manifest: manifestPath,
      imported: updates.map((i) => i.record),
      skippedOlder: images.length - updates.length,
    };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [run, ...extra] = process.argv.slice(2);
  if (!run || extra.length) throw new Error('Usage: bun app/e2e/capture/import.ts RUN_DIRECTORY');
  const receipt = JSON.parse(readFileSync(join(run, 'capture-attestation.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(run, 'manifest.json'), 'utf8'));
  const plan = createCapturePlan();
  const invocation = plan.invocations.find(
    (i) =>
      i.scenario === manifest.filters?.scenario &&
      i.platform === (manifest.driver === 'sim' ? 'ios' : 'android')
  );
  if (receipt.version !== 1 || !invocation || receipt.recipeSha256 !== invocation.recipeSha256)
    throw new Error('Capture recipe does not match the recorded attestation');
  const result = await importCaptureRun(run, { plan, attestation: receipt.attestation });
  // eslint-disable-next-line no-console -- explicit intake CLI
  console.log(
    JSON.stringify({
      manifest: result.manifest,
      imported: result.imported.length,
      skippedOlder: result.skippedOlder,
    })
  );
}
