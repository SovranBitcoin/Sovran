import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { CANONICAL_PAGES } from '../schema/pages';
import { createCapturePlan } from './plan';
import { importCaptureRun, type CaptureAttestation } from './import';
import { LIBRARY_CAPTURE_PROFILE } from '../drivers/capture-profile';

const plan = createCapturePlan();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stamp = { fingerprint: 'a'.repeat(64), gitSha: 'b'.repeat(40), gitDirty: true };
const attestation: CaptureAttestation = {
  sourceFingerprint: 'c'.repeat(64),
  appSourceBefore: stamp,
  appSourceAfter: stamp,
  nativeBuild: {
    fingerprint: 'd'.repeat(40),
    gitSha: 'b'.repeat(40),
    appVersion: '1.0.0',
    buildNumber: '1',
    builtAt: '2026-09-15T00:00:00Z',
    artifactSha256: 'f'.repeat(64),
  },
  nativeFingerprintBefore: 'd'.repeat(40),
  nativeFingerprintAfter: 'd'.repeat(40),
};

async function evidence(scenarioId = 'settings.routing.navigate') {
  const root = mkdtempSync(join(tmpdir(), 'capture-unit-'));
  dirs.push(root);
  const runDir = join(root, 'run');
  mkdirSync(runDir);
  const libraryDir = join(root, 'library');
  const invocation = plan.invocations.find(
    (i) => i.platform === 'ios' && i.scenario === scenarioId
  )!;
  const scenario = invocation.scenarios[0];
  const manifest = {
    version: 1,
    runId: 'run-unit',
    suite: invocation.suite,
    driver: 'sim',
    proof: 'product-run',
    sourceFingerprint: attestation.sourceFingerprint,
    recording: false,
    evidence: 'screenshots',
    startedAt: '2026-09-15T01:00:00Z',
    scenarios: [scenario.id],
    filters: { scenario: scenario.id },
  };
  const events: Record<string, unknown>[] = [];
  const emit = (event: Record<string, unknown>) =>
    events.push({
      seq: events.length,
      t: Date.parse(manifest.startedAt) + events.length + 1,
      ...event,
    });
  emit({
    type: 'run.begin',
    runId: manifest.runId,
    suite: invocation.suite,
    proof: 'product-run',
    totalScenarios: 1,
  });
  emit({ type: 'scenario.begin', id: scenario.id, lane: 'simulator' });
  // Deliberately synthetic test bytes, never application screenshots or product evidence.
  const { width, height } = LIBRARY_CAPTURE_PROFILE.ios.resolution;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  let artifactSeq = 0;
  for (const step of scenario.steps) {
    emit({
      type: step.action === 'assert' ? 'assertion.begin' : 'step.begin',
      stepId: step.id,
      ...(step.action === 'assert' ? {} : { kind: step.action }),
    });
    if (step.step.action === 'screenshot') {
      const file = `${scenario.id}/named/${step.step.name}-${String(++artifactSeq).padStart(3, '0')}.png`;
      mkdirSync(dirname(join(runDir, file)), { recursive: true });
      writeFileSync(join(runDir, file), png);
      emit({
        type: 'artifact',
        kind: 'screenshot',
        path: join(runDir, file),
        stepId: step.id,
        artifactSeq,
      });
    }
    emit({
      type: step.action === 'assert' ? 'assertion.end' : 'step.end',
      stepId: step.id,
      ...(step.action === 'assert' ? {} : { kind: step.action }),
      ok: true,
    });
  }
  // Mirror the runner: a scenario with no declared cleanup emits no cleanup phase.
  if (scenario.steps.some((step) => step.phase === 'cleanup'))
    emit({ type: 'cleanup.end', ok: true });
  emit({ type: 'final-state', ok: true, expected: 'wallet', actual: 'wallet' });
  emit({ type: 'scenario.end', id: scenario.id, ok: true });
  emit({
    type: 'run.end',
    runId: manifest.runId,
    proof: 'product-run',
    passed: 1,
    failed: 0,
    skipped: 0,
    deferred: 0,
    funds: 'n/a',
  });
  const save = () => {
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(
      join(runDir, 'events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    );
  };
  save();
  writeFileSync(
    join(runDir, 'session-1.json'),
    JSON.stringify({
      version: 1,
      runId: `${manifest.runId}-01`,
      parentRunId: manifest.runId,
      ephemeral: true,
      seedExport: false,
      scenarios: [scenario.id],
      captureProfile: 'library-v1',
      capture: {
        profile: 'library-v1',
        ...LIBRARY_CAPTURE_PROFILE.ios,
        locale: 'en-US',
        appearance: 'light',
        fontScale: 1,
      },
      simulator: {
        deviceType: LIBRARY_CAPTURE_PROFILE.ios.model,
        runtimeVersion: LIBRARY_CAPTURE_PROFILE.ios.runtime,
      },
    })
  );
  return {
    runDir,
    libraryDir,
    manifest,
    events,
    save,
    png,
    options: { plan, attestation, libraryDir },
  };
}

describe('capture inventory', () => {
  it('keeps every canonical native baseline, plus explicit press variants', () => {
    expect(CANONICAL_PAGES.length).toBe(104);
    expect(plan.baselineDenominator).toBe(CANONICAL_PAGES.length * 2);
    expect(plan.targets.filter((t) => t.baseline)).toHaveLength(CANONICAL_PAGES.length * 2);
    for (const platform of ['ios', 'android'])
      for (const page of CANONICAL_PAGES)
        expect(
          plan.targets.filter((t) => t.baseline && t.platform === platform && t.page === page)
        ).toHaveLength(1);
    expect(plan.targets.some((t) => t.state === 'p2pk' && t.status === 'blocked')).toBe(true);
    expect(plan.blocked.every((t) => t.blocker && t.blocker.length > 40)).toBe(true);
    expect(
      plan.occurrences.some((o) => o.scenario === 'settings.edit.profile' && !o.effectReviewed)
    ).toBe(true);
  });
  it('selects only focused effect-reviewed recipes and never infers captured status', () => {
    expect(plan.invocations.every((i) => i.scenario && i.scenarios.length === 1)).toBe(true);
    expect(plan.invocations.some((i) => i.scenario === 'settings.edit.profile')).toBe(false);
    expect(plan.invocations.some((i) => i.scenario === 'settings.seed.reveal')).toBe(false);
    expect(plan.invocations.some((i) => i.scenario === 'settings.keyring.generate')).toBe(false);
    expect(
      plan.targets.filter((t) => t.status === 'planned').every((t) => t.readinessStepIds.length > 0)
    ).toBe(true);
    expect(createCapturePlan(['android']).targets.filter((t) => t.baseline)).toHaveLength(
      CANONICAL_PAGES.length
    );
  });
  it('plans real default-state pages without approving their effectful controls', () => {
    const expected = [
      'composer',
      'claim-username',
      'settings-recovery',
      'settings-keyring',
      'profile-share',
      'receive-rails',
      'signer-activity',
      'signer-requests',
      'notification-followers',
      'whitenoise-setup',
      'settings-storage',
    ];
    for (const platform of ['ios', 'android'])
      for (const page of expected) {
        expect(
          plan.targets.find(
            (target) => target.platform === platform && target.page === page && target.baseline
          )
        ).toMatchObject({
          status: 'planned',
          evidenceClass: 'native-navigation',
          privacy: 'disposable-profile',
        });
      }
    const newIds = [
      'capture.account-entry',
      'capture.composer',
      'capture.signer-lists',
      'capture.receive-rails',
      'capture.followers',
      'capture.whitenoise-entry',
      'capture.storage',
    ];
    const forbidden = [
      'composer-publish',
      'claim-username-continue',
      'recovery-swipe',
      'keyring-import-trigger',
      'keyring-import-current-nsec',
      'keyring-import-submit',
      'whitenoise-setup-start',
      'signer-hub-share-row',
    ];
    for (const invocation of plan.invocations.filter((i) => newIds.includes(i.scenario))) {
      const steps = invocation.scenarios[0].steps;
      for (const { step } of steps) {
        const taps =
          step.action === 'tap'
            ? [step.selector]
            : step.action === 'tapUntil'
              ? step.sequence.flatMap((part) => ('tap' in part ? [part.tap] : []))
              : [];
        expect(taps.some((selector) => 'id' in selector && forbidden.includes(selector.id))).toBe(
          false
        );
        expect([
          'input',
          'typeText',
          'counterparty',
          'capture',
          'setClipboard',
          'setLiteralClipboard',
        ]).not.toContain(step.action);
      }
    }
  });
  it('blocks secret-bearing and unsupported fixture routes without dropping them', () => {
    for (const page of ['signer-share', 'signer-connect', 'onchain-send', 'whitenoise-dm'])
      expect(
        plan.targets
          .filter((t) => t.page === page)
          .every((t) => t.publicationEligibility === 'blocked')
      ).toBe(true);
    expect(plan.targets.find((t) => t.page === 'backup-words')?.evidenceClass).toBe(
      'native-fixture'
    );
  });
});

describe('verified capture import', () => {
  it('imports only selected PNGs, hashes original bytes, and retains the complete denominator', async () => {
    const e = await evidence();
    const result = await importCaptureRun(e.runDir, e.options);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].originalSha256).toBe(hash(e.png));
    expect(result.imported[0].functionalResult).toBe('not-established');
    expect(result.imported[0].manifestSha256).toBe(
      hash(readFileSync(join(e.runDir, 'manifest.json')))
    );
    expect(result.imported[0].eventsSha256).toBe(
      hash(readFileSync(join(e.runDir, 'events.jsonl')))
    );
    const library = JSON.parse(readFileSync(result.manifest, 'utf8'));
    expect(library.baselineDenominator).toBe(CANONICAL_PAGES.length * 2);
    expect(library.inventory.filter((t: { baseline: boolean }) => t.baseline)).toHaveLength(
      CANONICAL_PAGES.length * 2
    );
    expect(existsSync(join(e.libraryDir, 'ios/settings-routing.png'))).toBe(true);
    expect(existsSync(join(e.libraryDir, 'ios/wallet.png'))).toBe(false);
  });
  it('accepts a journey that declares no cleanup phase', async () => {
    // capture.onboarding ends at the wallet with no cleanup steps, so the runner
    // emits no cleanup phase. Demanding a cleanup.end disqualified a run that
    // passed perfectly; the final-state event is what proves the end state.
    const e = await evidence('capture.onboarding');
    const events = readFileSync(join(e.runDir, 'events.jsonl'), 'utf8');
    expect(events).not.toContain('"cleanup.end"');
    expect(events).toContain('"final-state"');
    const result = await importCaptureRun(e.runDir, e.options);
    expect(result.imported.length).toBeGreaterThan(0);
    expect(result.imported.every((record) => record.functionalResult === 'not-established')).toBe(
      true
    );
  });

  for (const failure of [
    'interrupted',
    'failed',
    'missing-readiness',
    'wrong-source',
    'fake',
    'wrong-page',
    'missing-step',
    'extra-scenario',
  ] as const) {
    it(`rejects ${failure} before creating the library`, async () => {
      const e = await evidence();
      if (failure === 'interrupted') e.events.pop();
      if (failure === 'failed') e.events.find((v) => v.type === 'step.end')!.ok = false;
      if (failure === 'missing-readiness') {
        const t = plan.targets.find((t) => t.platform === 'ios' && t.page === 'settings-routing')!;
        e.events.find(
          (v) =>
            (v.type === 'step.end' || v.type === 'assertion.end') &&
            v.stepId === t.readinessStepIds[0]
        )!.stepId = 'T999';
      }
      if (failure === 'wrong-source') e.manifest.sourceFingerprint = 'e'.repeat(64);
      if (failure === 'fake') e.manifest.driver = 'fake';
      if (failure === 'wrong-page')
        e.events.find((v) => v.type === 'artifact')!.path = '../private.png';
      if (failure === 'missing-step')
        e.events.find((v) => v.type === 'step.end')!.type = 'lifecycle';
      if (failure === 'extra-scenario') e.manifest.scenarios.push('settings.edit.profile');
      e.save();
      await expect(importCaptureRun(e.runDir, e.options)).rejects.toThrow();
      expect(existsSync(e.libraryDir)).toBe(false);
    });
  }
  it('rejects changed source/build attestations', async () => {
    const e = await evidence();
    await expect(
      importCaptureRun(e.runDir, {
        ...e.options,
        attestation: { ...attestation, appSourceAfter: { ...stamp, fingerprint: 'f'.repeat(64) } },
      })
    ).rejects.toThrow('Source/build');
    expect(existsSync(e.libraryDir)).toBe(false);
  });
  it('rejects unprofiled native sessions and incorrect native dimensions', async () => {
    const e = await evidence();
    const file = join(e.runDir, 'session-1.json');
    const session = JSON.parse(readFileSync(file, 'utf8'));
    session.capture.resolution.width = 1080;
    writeFileSync(file, JSON.stringify(session));
    await expect(importCaptureRun(e.runDir, e.options)).rejects.toThrow('requires');
    expect(existsSync(e.libraryDir)).toBe(false);
    rmSync(file);
    await expect(importCaptureRun(e.runDir, e.options)).rejects.toThrow('session');
  });
  it('does not let a caller turn a modified recipe into approved evidence', async () => {
    const e = await evidence();
    const changed = structuredClone(plan);
    changed.invocations.find(
      (i) => i.platform === 'ios' && i.scenario === 'settings.routing.navigate'
    )!.recipeSha256 = 'f'.repeat(64);
    await expect(importCaptureRun(e.runDir, { ...e.options, plan: changed })).rejects.toThrow(
      'Recipe changed'
    );
    expect(existsSync(e.libraryDir)).toBe(false);
  });
  it('preserves newer entries and rejects altered library bytes', async () => {
    const e = await evidence();
    await importCaptureRun(e.runDir, e.options);
    e.manifest.startedAt = '2026-09-14T01:00:00Z';
    for (const event of e.events) event.t = Number(event.t) - 24 * 60 * 60 * 1000;
    e.save();
    expect((await importCaptureRun(e.runDir, e.options)).skippedOlder).toBe(1);
    writeFileSync(join(e.libraryDir, 'ios/settings-routing.png'), 'tampered');
    await expect(importCaptureRun(e.runDir, e.options)).rejects.toThrow('integrity');
  });
});
