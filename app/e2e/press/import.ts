/* eslint-disable no-console -- press CLI boundary */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { createPressPlan, NATIVE_FRESHNESS, selectPressScenario, type PressPlan } from './plan';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid evidence object');
  return value as Record<string, unknown>;
}

function contained(root: string, path: string) {
  const result = realpathSync(resolve(root, path));
  const rel = relative(root, result);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !statSync(result).isFile())
    throw new Error('Evidence must be a contained regular file');
  return result;
}

/** Read ALL inputs before staging anything. Only whitelisted PNG bytes and
 * curated attribution leave the raw run; never copy AX, state, logs or keys. */
export async function importPressRuns(
  runDirs: string[],
  plan: PressPlan = createPressPlan(['ios', 'android'])
) {
  if (!runDirs.length) throw new Error('Import requires explicit run directories (never latest)');
  const roots = runDirs.map((dir) => realpathSync(dir));
  if (new Set(roots).size !== roots.length) throw new Error('Duplicate run directory');
  const inputs = [];
  const selections = new Set<string>();
  for (const root of roots) {
    if (existsSync(join(root, 'press')))
      throw new Error('Candidate press directory already exists; no replacement is allowed');
    const manifestBytes = readFileSync(contained(root, 'manifest.json'));
    const manifest = object(JSON.parse(manifestBytes.toString()));
    const platform =
      manifest.driver === 'sim' ? 'ios' : manifest.driver === 'android' ? 'android' : undefined;
    const scenarioFilter = object(manifest.filters).scenario;
    if (scenarioFilter !== undefined && typeof scenarioFilter !== 'string')
      throw new Error('Invalid scenario filter');
    const selected = selectPressScenario(plan, scenarioFilter);
    const invocation = selected.invocations.find(
      (item) =>
        item.platform === platform &&
        item.suite === manifest.suite &&
        JSON.stringify(manifest.scenarios) ===
          JSON.stringify(item.scenarios.map((scenario) => scenario.id))
    );
    if (
      manifest.version !== 1 ||
      manifest.proof !== 'product-run' ||
      !platform ||
      !invocation ||
      typeof manifest.runId !== 'string' ||
      !/^[a-zA-Z0-9-]+$/.test(manifest.runId) ||
      typeof manifest.sourceFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(manifest.sourceFingerprint) ||
      typeof manifest.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(manifest.startedAt)) ||
      manifest.funded !== undefined ||
      JSON.stringify(manifest.scenarios) !==
        JSON.stringify(invocation.scenarios.map((item) => item.id))
    )
      throw new Error(
        'Import requires an attributed native product-run with the exact safe press selection'
      );
    const selection = `${platform}/${invocation.suite}/${invocation.scenarios.map((scenario) => scenario.id).join(',')}`;
    if (selections.has(selection)) throw new Error(`Ambiguous duplicate selection: ${selection}`);
    selections.add(selection);
    const eventsBytes = readFileSync(contained(root, 'events.jsonl'));
    const events = eventsBytes
      .toString()
      .trim()
      .split('\n')
      .map((line) => object(JSON.parse(line)));
    if (
      events.some(
        (event, index) =>
          event.seq !== index || typeof event.t !== 'number' || !Number.isFinite(event.t)
      )
    )
      throw new Error('Invalid event sequence');
    const begin = events[0];
    const end = events.at(-1);
    if (
      begin?.type !== 'run.begin' ||
      begin.runId !== manifest.runId ||
      begin.proof !== 'product-run' ||
      begin.suite !== invocation.suite ||
      begin.totalScenarios !== invocation.scenarios.length ||
      end?.type !== 'run.end' ||
      end.runId !== manifest.runId ||
      end.proof !== 'product-run' ||
      end.passed !== invocation.scenarios.length ||
      end.failed !== 0 ||
      end.skipped !== 0 ||
      end.deferred !== 0 ||
      end.funds !== 'n/a' ||
      events.filter((event) => event.type === 'run.begin' || event.type === 'run.end').length !==
        2 ||
      events.some(
        (event) =>
          event.ok === false ||
          event.skipped === true ||
          event.error ||
          [
            'skip',
            'deferred',
            'cleanup.skipped',
            'funding',
            'quarantine',
            'baseline.failure',
          ].includes(String(event.type))
      )
    )
      throw new Error(
        'Import requires a complete passing run without failed, skipped, deferred or funded evidence'
      );
    const scenarioBegins = events.filter((event) => event.type === 'scenario.begin');
    const scenarioEnds = events.filter((event) => event.type === 'scenario.end');
    if (
      JSON.stringify(scenarioBegins.map((event) => event.id)) !==
        JSON.stringify(manifest.scenarios) ||
      JSON.stringify(scenarioEnds.map((event) => event.id)) !== JSON.stringify(manifest.scenarios)
    )
      throw new Error('Scenario evidence does not match selection');
    const images = [];
    for (const [index, scenario] of invocation.scenarios.entries()) {
      const first = scenarioBegins[index];
      const last = scenarioEnds[index];
      if (
        first.lane !== 'simulator' ||
        last.ok !== true ||
        Number(first.seq) >= Number(last.seq) ||
        (index > 0 && Number(first.seq) <= Number(scenarioEnds[index - 1].seq))
      )
        throw new Error('Invalid scenario interval');
      const segment = events.slice(Number(first.seq) + 1, Number(last.seq));
      const cleanup = segment.filter((event) => event.type === 'cleanup.end');
      const final = segment.filter((event) => event.type === 'final-state');
      if (
        cleanup.length !== 1 ||
        cleanup[0].ok !== true ||
        final.length !== 1 ||
        final[0].ok !== true ||
        final[0].expected !== scenario.endState ||
        final[0].actual !== scenario.endState ||
        Number(cleanup[0].seq) >= Number(final[0].seq)
      )
        throw new Error(`Missing successful cleanup/final-state: ${scenario.id}`);
      const artifacts = segment.filter(
        (event) =>
          event.type === 'artifact' &&
          event.kind === 'screenshot' &&
          typeof event.path === 'string' &&
          event.path.includes('/named/')
      );
      if (artifacts.length !== scenario.captures.length)
        throw new Error(`Incomplete named captures: ${scenario.id}`);
      for (const [captureIndex, capture] of scenario.captures.entries()) {
        const artifact = artifacts[captureIndex];
        if (
          typeof artifact.path !== 'string' ||
          !artifact.path.endsWith('.png') ||
          artifact.stepId !== capture.stepId ||
          !Number.isSafeInteger(artifact.artifactSeq) ||
          Number(artifact.artifactSeq) < 1
        )
          throw new Error('Invalid screenshot attribution');
        const source = contained(root, artifact.path);
        const expected = `${scenario.id}/named/${capture.page}-${String(artifact.artifactSeq).padStart(3, '0')}.png`;
        if (relative(root, source) !== expected)
          throw new Error('Screenshot path does not match scenario/page/sequence');
        const completed = segment.filter(
          (event) => event.type === 'step.end' && event.stepId === capture.stepId
        );
        if (
          completed.length !== 1 ||
          completed[0].ok !== true ||
          Number(completed[0].seq) <= Number(artifact.seq)
        )
          throw new Error('Screenshot step did not complete');
        const bytes = readFileSync(source);
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          throw new Error('PNG only');
        const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 });
        const { format, width, height } = await image.metadata();
        if (
          format !== 'png' ||
          !width ||
          !height ||
          width >= height ||
          (platform === 'ios' &&
            !['1206x2622', '1260x2736', '1290x2796', '1320x2868'].includes(`${width}x${height}`)) ||
          (platform === 'android' && (width < 1080 || height < 1920))
        )
          throw new Error('Unsupported native portrait image dimensions');
        const stats = await image.stats();
        if (stats.channels.slice(0, 3).every((channel) => channel.max - channel.min < 2))
          throw new Error('Blank screenshot');
        const mapping = plan.captures.find(
          (item) =>
            item.platform === platform &&
            item.scenario === scenario.id &&
            item.page === capture.page &&
            item.occurrence === capture.occurrence
        );
        if (mapping)
          images.push({
            bytes,
            file: `${mapping.name}.png`,
            key: mapping.key,
            context: mapping.context,
            metadata: mapping.metadata,
            scenario: scenario.id,
            page: capture.page,
            occurrence: capture.occurrence,
            stepId: capture.stepId,
            source: expected,
            sha256: hash(bytes),
            width,
            height,
          });
      }
    }
    inputs.push({
      root,
      images,
      attribution: {
        runId: manifest.runId,
        platform,
        suite: invocation.suite,
        sourceFingerprint: manifest.sourceFingerprint,
        startedAt: manifest.startedAt,
        manifestSha256: hash(manifestBytes),
        eventsSha256: hash(eventsBytes),
      },
    });
  }
  const outputs: string[] = [];
  for (const input of inputs) {
    const stage = await mkdtemp(join(input.root, '.press-'));
    try {
      for (const image of input.images) {
        const destination = join(stage, image.file);
        await writeFile(destination, image.bytes, { mode: 0o600, flag: 'wx' });
        if (hash(readFileSync(destination)) !== image.sha256)
          throw new Error('Candidate hash mismatch');
      }
      await writeFile(
        join(stage, 'manifest.json'),
        JSON.stringify(
          {
            version: 1,
            status: 'unreviewed-candidate',
            nativeFreshness: NATIVE_FRESHNESS,
            websitePlatformEligible: input.attribution.platform === 'ios',
            contextVersion: plan.contextVersion,
            ...input.attribution,
            screenshots: input.images.map(({ bytes: _bytes, ...image }) => image),
            unsupportedRegistered: plan.unsupportedRegistered.filter((key) =>
              key.startsWith(`${input.attribution.platform}/`)
            ),
          },
          null,
          2
        ) + '\n',
        { mode: 0o600 }
      );
      const destination = join(input.root, 'press');
      // Reserve before moving; an existing review folder is never replaced.
      await mkdir(destination, { mode: 0o700 });
      await rename(stage, destination);
      outputs.push(destination);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  return outputs;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg.startsWith('--')))
      throw new Error('Usage: bun app/e2e/press/import.ts RUN_DIR [RUN_DIR ...]');
    console.log((await importPressRuns(args)).join('\n'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Press import failed');
    process.exitCode = 1;
  }
}
