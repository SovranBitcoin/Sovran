import { afterAll, afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { createPressPlan, nativeArgs, ROOT, selectPressScenario } from './plan';
import { checkStorage, MIN_FREE_BYTES, parsePressArgs } from './run';
import { importPressRuns } from './import';
import screenshotContext from '../../../press/artwork/source/screenshot-context.json';
import { isCanonicalPage } from '../schema/pages';

const plan = createPressPlan(['ios', 'android']);
const temporary: string[] = [];
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), 'press-test-'));
  temporary.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('real loader selects screenshot suites and three exact non-funded full selections', () => {
  expect(plan.invocations).toHaveLength(10);
  for (const invocation of plan.invocations) {
    expect(invocation.scenarios.every((scenario) => scenario.lane === 'simulator')).toBe(true);
    const args = nativeArgs(invocation);
    expect(args).toContain('--i-approve-destructive-reset');
    expect(args).not.toContain('--i-accept-test-fund-loss');
    expect(args).toContain('--no-record');
    expect(args).toContain('screenshots');
    if (invocation.suite === 'full') {
      expect(invocation.scenarios).toHaveLength(1);
      expect(invocation.scenario).toBe(invocation.scenarios[0].id);
    }
  }
  expect(plan.unsupportedRegistered).toEqual([]);
  expect(plan.captures).toHaveLength(62);
  expect(plan.websitePlatform).toBe('ios');
});

test('strict arguments and conservative storage floor', () => {
  expect(parsePressArgs([]).platforms).toEqual(['ios', 'android']);
  expect(parsePressArgs(['--plan', 'ios'])).toEqual({ platforms: ['ios'], planOnly: true });
  for (const args of [
    ['fake'],
    ['--replace-pins'],
    ['ios', 'android'],
    ['--plan', '--plan'],
    ['--i-accept-test-fund-loss'],
  ])
    expect(() => parsePressArgs(args)).toThrow();
  expect(() => checkStorage(['test'], () => 5.8 * 1024 ** 3)).toThrow('before Metro');
  expect(() => checkStorage(['test'], () => MIN_FREE_BYTES)).not.toThrow();
  expect(() => checkStorage(['test'], () => NaN)).toThrow();
});

test('focused capture selects only an already approved scenario, on each requested platform', () => {
  expect(parsePressArgs(['ios', '--scenario', 'marketing.screenshots', '--plan'])).toEqual({
    platforms: ['ios'],
    planOnly: true,
    scenario: 'marketing.screenshots',
  });
  for (const args of [
    ['--scenario'],
    ['--scenario', '--plan'],
    ['--scenario', 'a', '--scenario', 'b'],
  ])
    expect(() => parsePressArgs(args)).toThrow();
  const focused = selectPressScenario(plan, 'marketing.screenshots');
  expect(focused.invocations).toHaveLength(2);
  for (const invocation of focused.invocations) {
    expect(invocation.scenarios.map(({ id }) => id)).toEqual(['marketing.screenshots']);
    expect(nativeArgs(invocation)).toContain('--scenario');
    expect(invocation.scenario).toBe('marketing.screenshots');
  }
  expect(focused.captures.every(({ scenario }) => scenario === 'marketing.screenshots')).toBe(true);
  expect(() => selectPressScenario(plan, 'receive.lightning.sat')).toThrow(
    'approved press scenario'
  );
  expect(() => selectPressScenario(plan, 'marketing')).toThrow('approved press scenario');
});

test('real loader fails closed on unsafe full selection or corrupted registry', () => {
  const root = directory();
  for (const folder of ['fixtures', 'scenarios', 'suites'])
    cpSync(join(ROOT, 'app/e2e', folder), join(root, 'app/e2e', folder), { recursive: true });
  mkdirSync(join(root, 'press/artwork/source'), { recursive: true });
  cpSync(
    join(ROOT, 'press/artwork/source/screenshots.json'),
    join(root, 'press/artwork/source/screenshots.json')
  );
  const path = join(root, 'app/e2e/scenarios/backup-flow.json');
  writeFileSync(
    path,
    readFileSync(path, 'utf8').replace('"lane": "simulator"', '"lane": "funded"')
  );
  expect(() => createPressPlan(['ios'], root)).toThrow('loader rejected');
});

test('the native command is constrained by the existing CLI parser', async () => {
  const { parseCliArgs } = await import('../core/selection');
  for (const invocation of plan.invocations) {
    const options = parseCliArgs(nativeArgs(invocation).slice(1));
    expect(options).toMatchObject({
      command: 'run',
      suite: invocation.suite,
      acceptTestFundLoss: false,
      approveDestructiveReset: true,
      evidence: 'screenshots',
      noRecord: true,
    });
    expect(options.scenario).toBe(invocation.scenario);
  }
});

// Synthetic evidence tests the intake contract, not native execution or freshness.
const png = await sharp(
  Buffer.from(
    '<svg width="1080" height="1920"><rect width="1080" height="1920" fill="#123456"/><rect width="500" height="900" fill="#abcdef"/></svg>'
  )
)
  .png()
  .toBuffer();
const iosPng = await sharp(png).resize(1320, 2868).png().toBuffer();
const canonical = [
  'press/artwork/source/screenshots.json',
  'scripts/fixtures/artwork-store-pins.json',
]
  .filter((path) => existsSync(join(ROOT, path)))
  .map((path) => ({ path: join(ROOT, path), bytes: readFileSync(join(ROOT, path)) }));
afterAll(() => {
  for (const file of canonical) expect(readFileSync(file.path)).toEqual(file.bytes);
});

function fixture(
  suite = 'full',
  platform = 'android',
  scenario = 'backup.flow',
  selectedPlan = plan
) {
  const root = directory();
  const invocation = selectedPlan.invocations.find(
    (item) =>
      item.suite === suite &&
      item.platform === platform &&
      (suite !== 'full' || item.scenario === scenario)
  )!;
  const manifest = {
    version: 1,
    runId: 'fixture-run',
    suite,
    driver: platform === 'ios' ? 'sim' : 'android',
    proof: 'product-run',
    sourceFingerprint: 'a'.repeat(64),
    startedAt: '2026-09-14T00:00:00Z',
    scenarios: invocation.scenarios.map((scenario) => scenario.id),
    recording: false,
    evidence: 'screenshots',
    filters: invocation.scenario ? { scenario: invocation.scenario } : {},
  };
  const events: Record<string, unknown>[] = [];
  const emit = (event: Record<string, unknown>) =>
    events.push({ ...event, seq: events.length, t: 1000 + events.length });
  emit({
    type: 'run.begin',
    runId: manifest.runId,
    proof: 'product-run',
    suite,
    totalScenarios: invocation.scenarios.length,
  });
  let artifactSeq = 0;
  for (const scenario of invocation.scenarios) {
    emit({ type: 'scenario.begin', id: scenario.id, lane: 'simulator' });
    for (const capture of scenario.captures) {
      artifactSeq++;
      const path = join(
        root,
        scenario.id,
        'named',
        `${capture.page}-${String(artifactSeq).padStart(3, '0')}.png`
      );
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, platform === 'ios' ? iosPng : png);
      emit({ type: 'artifact', kind: 'screenshot', path, stepId: capture.stepId, artifactSeq });
      emit({ type: 'step.end', stepId: capture.stepId, kind: 'screenshot', ok: true });
    }
    emit({ type: 'cleanup.end', ok: true });
    emit({ type: 'final-state', expected: scenario.endState, actual: scenario.endState, ok: true });
    emit({ type: 'scenario.end', id: scenario.id, ok: true });
  }
  emit({
    type: 'run.end',
    runId: manifest.runId,
    proof: 'product-run',
    passed: invocation.scenarios.length,
    failed: 0,
    skipped: 0,
    deferred: 0,
    funds: 'n/a',
  });
  const save = () => {
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(
      join(root, 'events.jsonl'),
      events.map((event, seq) => JSON.stringify({ ...event, seq })).join('\n') + '\n'
    );
  };
  save();
  return { root, manifest, events, save };
}

test('imports exact PNG bytes and hashes, curates metadata, and never claims freshness', async () => {
  const run = fixture('full', 'ios');
  writeFileSync(join(run.root, 'private.store.json'), 'private fixture sentinel');
  const [out] = await importPressRuns([run.root], plan);
  expect(readdirSync(out).sort()).toEqual(['backup-words.png', 'manifest.json']);
  expect(readFileSync(join(out, 'backup-words.png')).equals(iosPng)).toBe(true);
  const report = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  expect(report.status).toBe('unreviewed-candidate');
  expect(report.nativeFreshness).toContain('unverified');
  expect(report.websitePlatformEligible).toBe(true);
  expect(report.sourceFingerprint).toBe('a'.repeat(64));
  expect(report).toMatchObject({
    runId: run.manifest.runId,
    suite: run.manifest.suite,
    startedAt: run.manifest.startedAt,
    contextVersion: screenshotContext.version,
    manifestSha256: createHash('sha256')
      .update(readFileSync(join(run.root, 'manifest.json')))
      .digest('hex'),
    eventsSha256: createHash('sha256')
      .update(readFileSync(join(run.root, 'events.jsonl')))
      .digest('hex'),
  });
  expect(report.screenshots[0]).toMatchObject({
    width: 1320,
    height: 2868,
    occurrence: 1,
    sha256: createHash('sha256').update(iosPng).digest('hex'),
    context: 'backup-words',
    metadata: screenshotContext.contexts['backup-words'],
    scenario: 'backup.flow',
    page: 'backup-words',
    stepId: plan.captures.find((capture) => capture.key === 'ios/backup-words')!.stepId,
  });
  expect(readFileSync(join(run.root, report.screenshots[0].source)).equals(iosPng)).toBe(true);
  await expect(importPressRuns([run.root], plan)).rejects.toThrow('already exists');
});

test('imports a complete explicitly focused tour, never a truncated suite or interrupted run', async () => {
  const focused = selectPressScenario(plan, 'marketing.screenshots');
  const run = fixture('marketing-screenshots', 'ios', 'marketing.screenshots', focused);
  const [out] = await importPressRuns([run.root], plan);
  const report = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  expect(report.screenshots).toHaveLength(9);
  expect(report.screenshots.some((image: { key: string }) => image.key === 'ios/receive-qr')).toBe(
    true
  );
  expect(report.status).toBe('unreviewed-candidate');

  const truncated = fixture('marketing-screenshots', 'ios', 'marketing.screenshots', focused);
  truncated.manifest.filters = {};
  truncated.save();
  await expect(importPressRuns([truncated.root], plan)).rejects.toThrow(
    'exact safe press selection'
  );

  const interrupted = fixture('marketing-screenshots', 'ios', 'marketing.screenshots', focused);
  interrupted.events.pop();
  interrupted.save();
  await expect(importPressRuns([interrupted.root], plan)).rejects.toThrow('complete passing run');
  expect(existsSync(join(interrupted.root, 'press'))).toBe(false);
});

test.each([
  [1206, 2622], // Default iPhone 17 Pro.
  [1260, 2736],
  [1290, 2796],
  [1320, 2868],
])(
  'imports native iPhone PNG fixtures at %dx%d without changing metadata',
  async (width, height) => {
    const run = fixture('full', 'ios');
    const bytes = await sharp(png).resize(width, height).png().toBuffer();
    for (const event of run.events.filter((event) => event.type === 'artifact'))
      writeFileSync(String(event.path), bytes);
    const [out] = await importPressRuns([run.root], plan);
    const report = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(report.screenshots).toHaveLength(1);
    expect(report.screenshots[0]).toMatchObject({
      width,
      height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      context: 'backup-words',
      metadata: screenshotContext.contexts['backup-words'],
    });
    expect(readFileSync(join(out, 'backup-words.png')).equals(bytes)).toBe(true);
  }
);

test('disambiguates ai occurrence 2 and all eight wallpapers by scenario, page and step', async () => {
  const run = fixture('marketing-screenshots');
  const [out] = await importPressRuns([run.root], plan);
  const report = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  expect(report.websitePlatformEligible).toBe(false);
  expect(
    report.screenshots.find((image: { key: string }) => image.key === 'android/ai-model-picker')
  ).toMatchObject({ scenario: 'marketing.screenshots', page: 'ai', occurrence: 2 });
  const wallpapers = report.screenshots.filter((image: { key: string }) =>
    image.key.startsWith('android/wallet-')
  );
  expect(wallpapers.map((image: { occurrence: number }) => image.occurrence)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
}, 15000);

test.each(['fake', 'orchestration-smoke', 'fingerprint', 'full-extra'])(
  'rejects invalid manifest: %s',
  async (bad) => {
    const run = fixture();
    if (bad === 'fake') run.manifest.driver = 'fake';
    if (bad === 'orchestration-smoke') run.manifest.proof = bad;
    if (bad === 'fingerprint') run.manifest.sourceFingerprint = '';
    if (bad === 'full-extra') run.manifest.scenarios.push('send.lightning.sat');
    run.save();
    await expect(importPressRuns([run.root], plan)).rejects.toThrow();
    expect(existsSync(join(run.root, 'press'))).toBe(false);
  }
);

test.each([
  'failed',
  'skipped',
  'deferred',
  'missing-end',
  'cleanup',
  'final-state',
  'wrong-page',
  'wrong-step',
  'missing-image',
])('rejects incomplete evidence: %s', async (bad) => {
  const run = fixture();
  if (['failed', 'skipped', 'deferred'].includes(bad)) run.events.at(-1)![bad] = 1;
  if (bad === 'missing-end') run.events.pop();
  if (bad === 'cleanup') run.events.find((event) => event.type === 'cleanup.end')!.ok = false;
  if (bad === 'final-state')
    run.events.find((event) => event.type === 'final-state')!.actual = 'unknown';
  const artifact = run.events.find((event) => event.type === 'artifact')!;
  if (bad === 'wrong-page')
    artifact.path = String(artifact.path).replace(
      /\/named\/.*-(\d+)\.png$/,
      '/named/wallet-$1.png'
    );
  if (bad === 'wrong-step') artifact.stepId = 'T999';
  if (bad === 'missing-image') rmSync(String(artifact.path));
  run.save();
  await expect(importPressRuns([run.root], plan)).rejects.toThrow();
  expect(existsSync(join(run.root, 'press'))).toBe(false);
});

test.each(['escape', 'symlink', 'non-png', 'small', 'truncated'])(
  'rejects unsafe image: %s',
  async (bad) => {
    const run = fixture();
    const artifact = run.events.find((event) => event.type === 'artifact')!;
    const path = String(artifact.path);
    if (bad === 'escape' || bad === 'symlink') {
      const outside = join(directory(), 'outside.png');
      writeFileSync(outside, png);
      if (bad === 'escape') artifact.path = outside;
      else {
        rmSync(path);
        symlinkSync(outside, path);
      }
    }
    if (bad === 'non-png') writeFileSync(path, await sharp(png).jpeg().toBuffer());
    if (bad === 'small') writeFileSync(path, await sharp(png).resize(100, 200).png().toBuffer());
    if (bad === 'truncated') writeFileSync(path, png.subarray(0, 100));
    run.save();
    await expect(importPressRuns([run.root], plan)).rejects.toThrow();
  }
);

test('bad later input stages nothing and preserves canonical files and earlier candidates', async () => {
  const good = fixture('full', 'ios');
  const bad = fixture();
  bad.manifest.proof = 'orchestration-smoke';
  bad.save();
  await expect(importPressRuns([good.root, bad.root], plan)).rejects.toThrow();
  expect(
    readdirSync(good.root).some((name) => name.startsWith('.press-') || name === 'press')
  ).toBe(false);
  for (const file of canonical) expect(readFileSync(file.path)).toEqual(file.bytes);
});

test('a store run exports only mapped press originals after validating the complete store set', async () => {
  const run = fixture('store-screenshots');
  const [out] = await importPressRuns([run.root], plan);
  expect(readdirSync(out).sort()).toEqual([
    'ai.png',
    'contacts.png',
    'lightning-receive.png',
    'manifest.json',
    'wallet.png',
  ]);
  const report = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  for (const image of report.screenshots) {
    expect(
      readFileSync(join(out, image.file)).equals(readFileSync(join(run.root, image.source)))
    ).toBe(true);
  }
});

test('explicit intake rejects zero, duplicate and ambiguous run directories', async () => {
  await expect(importPressRuns([], plan)).rejects.toThrow('explicit');
  const one = fixture();
  const two = fixture();
  await expect(importPressRuns([one.root, one.root], plan)).rejects.toThrow('Duplicate');
  await expect(importPressRuns([one.root, two.root], plan)).rejects.toThrow('Ambiguous');
  expect(existsSync(join(one.root, 'press'))).toBe(false);
});

test('shared JSON context and collection references resolve without native imports', () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, 'press/artwork/source/screenshots.json'), 'utf8')
  );
  const contexts = screenshotContext.contexts;
  expect(screenshotContext.version).toBe(1);
  for (const [id, metadata] of Object.entries(contexts)) {
    expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    for (const text of [
      metadata.caption,
      metadata.alt,
      metadata.purpose,
      metadata.state,
      metadata.flow.id,
      metadata.flow.position,
    ])
      expect(text.trim().length).toBeGreaterThan(0);
    expect(metadata.concepts.length).toBeGreaterThan(0);
    expect(new Set(metadata.concepts).size).toBe(metadata.concepts.length);
    for (const page of [
      metadata.page,
      ...metadata.relatedPages,
      ...metadata.flow.from,
      ...metadata.flow.to,
    ])
      expect(isCanonicalPage(page)).toBe(true);
  }
  for (const key of Object.keys(registry)) {
    const shot = registry[key];
    expect(contexts).toHaveProperty(shot.context);
    expect(contexts[shot.context as keyof typeof contexts].page).toBe(shot.page);
    if (shot.run && shot.sha256) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(ROOT, 'press/artwork', shot.file)))
          .digest('hex')
      ).toBe(shot.sha256);
    }
  }
  expect(new Set(screenshotContext.collections.map((collection) => collection.id)).size).toBe(
    screenshotContext.collections.length
  );
  for (const collection of screenshotContext.collections) {
    expect(collection.title.trim().length).toBeGreaterThan(0);
    expect(collection.description.trim().length).toBeGreaterThan(0);
    expect(collection.screenshots.length).toBeGreaterThan(1);
    expect(new Set(collection.screenshots).size).toBe(collection.screenshots.length);
    for (const key of collection.screenshots) expect(registry).toHaveProperty(key);
  }
  for (const capture of plan.captures) {
    expect(capture.metadata).toEqual(contexts[capture.context as keyof typeof contexts]);
    if (registry[capture.key]) expect(capture.context).toBe(registry[capture.key].context);
  }
});

test('registry provenance is internally consistent across refreshes', () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, 'press/artwork/source/screenshots.json'), 'utf8')
  ) as Record<string, Record<string, unknown>>;
  for (const [key, entry] of Object.entries(registry)) {
    expect(entry.file).toBe(`source/screenshots/${key}.png`);
    // A run and its hash are recorded together, never one without the other.
    expect(entry.run === null).toBe(entry.sha256 === null);
    if (entry.run !== null) expect(entry.run).toMatch(/^run-[A-Za-z0-9-]+$/);
    if (entry.availability !== undefined) expect(entry.availability).toBe('unavailable');
    if (entry.freshness !== undefined) {
      expect(entry.freshness).toBe('stale');
      // Withdrawn captures keep their historical run and say why.
      expect(
        String(entry.staleReason ?? entry.unavailableReason ?? '').trim().length
      ).toBeGreaterThan(0);
    }
    if (entry.nativeBuild !== undefined) {
      const build = entry.nativeBuild as Record<string, unknown>;
      expect(entry.run).not.toBeNull();
      expect(Number.isFinite(Date.parse(String(entry.capturedAt)))).toBe(true);
      expect(build.fingerprint).toMatch(/^[a-f0-9]{40,64}$/);
      expect(build.gitSha).toMatch(/^[a-f0-9]{40}$/);
      expect(typeof build.appVersion).toBe('string');
      expect(entry.freshness).toBeUndefined();
    }
  }
});

test('known-defective captures stay withdrawn until a stamped refresh replaces them', () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, 'press/artwork/source/screenshots.json'), 'utf8')
  ) as Record<string, Record<string, unknown>>;
  for (const key of ['ios/receive-qr', 'ios/notification-mint-changes']) {
    const entry = registry[key];
    if (entry.nativeBuild === undefined) expect(entry.freshness).toBe('stale');
  }
});

test('P2PK mappings follow asserted states and never alias a retained Unified QR', () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, 'press/artwork/source/screenshots.json'), 'utf8')
  );
  for (const [name, file, scenario, page, occurrence, label, id] of [
    [
      'settings-keyring',
      'settings-keyring-generate.json',
      'settings.keyring.generate',
      'settings-keyring',
      2,
      'YOUR KEYS (3)',
      undefined,
    ],
    [
      'receive-qr-p2pk',
      'receive-qr-display-tabs.json',
      'receive.qr-display.tabs',
      'receive-qr',
      6,
      undefined,
      'receive-creq-p2pk-state:1',
    ],
  ] as const) {
    const source = JSON.parse(readFileSync(join(ROOT, 'app/e2e/scenarios', file), 'utf8'));
    let count = 0;
    const index = source.steps.findIndex(
      (step: { action: string; name?: string }) =>
        step.action === 'screenshot' && step.name === page && ++count === occurrence
    );
    expect(source.steps[index - 1]).toMatchObject({
      action: 'waitFor',
      selector: label ? { label } : { id },
    });
    for (const platform of ['ios', 'android']) {
      const key = `${platform}/${name}`;
      expect(plan.captures.find((capture) => capture.key === key)).toMatchObject({
        scenario,
        page,
        occurrence,
      });
      // Either still a withdrawn request, or a promoted capture carrying both build stamps.
      if (registry[key].run === null) {
        expect(registry[key]).toMatchObject({ availability: 'unavailable', sha256: null });
        expect(registry[key].unavailableReason.length).toBeGreaterThan(0);
        expect(existsSync(join(ROOT, 'press/artwork', registry[key].file))).toBe(false);
      } else {
        expect(registry[key].availability).toBeUndefined();
        expect(registry[key].nativeBuild).toBeDefined();
        expect(registry[key].appSource).toBeDefined();
      }
      expect(registry[key].file).not.toBe(registry[`${platform}/receive-qr`].file);
    }
  }
});

test('receive tour uses current Unified controls, not the removed method pills', () => {
  const scenario = JSON.parse(
    readFileSync(join(ROOT, 'app/e2e/scenarios/receive-qr-display-tabs.json'), 'utf8')
  );
  const steps = JSON.stringify(scenario.steps);
  for (const removed of [
    'receive-unified-rail-onchain',
    'receive-unified-rail-bolt12',
    'receive-unified-rail-creq',
    'BOLT 12, included',
  ])
    expect(steps).not.toContain(removed);
  expect(scenario.steps).toContainEqual({
    action: 'waitFor',
    selector: { id: 'receive-unified-rails-state' },
    timeoutMs: 45000,
  });
  expect(scenario.steps).toContainEqual({
    action: 'waitFor',
    selector: { id: 'receive-unified-rail-switch-bolt12' },
    state: 'enabled',
    value: '1',
    timeoutMs: 45000,
  });
});

test('imports separate full-suite keyring and locked-request runs with inherited context', async () => {
  const keyring = fixture('full', 'ios', 'settings.keyring.generate');
  const receive = fixture('full', 'ios', 'receive.qr-display.tabs');
  const outputs = await importPressRuns([keyring.root, receive.root], plan);
  for (const [index, name] of ['settings-keyring', 'receive-qr-p2pk'].entries()) {
    const report = JSON.parse(readFileSync(join(outputs[index], 'manifest.json'), 'utf8'));
    expect(report.screenshots).toHaveLength(1);
    const capture = plan.captures.find((capture) => capture.key === `ios/${name}`)!;
    expect(report.screenshots[0]).toMatchObject({
      key: capture.key,
      context: capture.context,
      metadata: capture.metadata,
      scenario: capture.scenario,
      page: capture.page,
      occurrence: capture.occurrence,
      stepId: capture.stepId,
      sha256: createHash('sha256').update(iosPng).digest('hex'),
    });
    expect(report.status).toBe('unreviewed-candidate');
  }
}, 15000);
