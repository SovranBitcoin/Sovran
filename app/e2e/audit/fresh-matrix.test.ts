import { afterEach, describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ScenarioCatalogEntry, RunDetail } from '../viewer/lib/types';
import { ownedAndroidAvdName, ownedAndroidAvdRootPrefix } from '../drivers/android/android-session';
import {
  auditFreshMatrixEvidence,
  loadWorkspaceFreshMatrixSource,
  runWorkspaceFreshMatrixAudit,
  type ExpectedMatrixPair,
} from './fresh-matrix';

const RUN_ID = '2026-07-21T02-00-00-000Z-12345678';
const STARTED_AT = '2026-07-21T02:00:00.000Z';
const SCENARIO_ID = 'wallet.example';
const SOURCE_FINGERPRINT = 'a'.repeat(64);
const FUNDED_ASSET = {
  mintUrl: 'https://mint.example',
  unit: 'sat' as const,
  accountIndex: 0 as const,
  maxPrincipal: 10,
};

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeStrictArtifacts(): string {
  const artifactsRoot = mkdtempSync(join(tmpdir(), 'sovran-e2e-matrix-'));
  temporaryRoots.push(artifactsRoot);
  const runDir = join(artifactsRoot, `run-${RUN_ID}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      runId: RUN_ID,
      suite: 'full',
      driver: 'sim',
      proof: 'product-run',
      sourceFingerprint: SOURCE_FINGERPRINT,
      startedAt: STARTED_AT,
      scenarios: [SCENARIO_ID],
    })
  );
  const events = [
    {
      type: 'run.begin',
      runId: RUN_ID,
      proof: 'product-run',
      suite: 'full',
      totalScenarios: 1,
    },
    { type: 'suite.begin', suite: 'full' },
    {
      type: 'scenario.begin',
      id: SCENARIO_ID,
      name: 'Wallet example',
      lane: 'simulator',
      index: 1,
      total: 1,
    },
    {
      type: 'artifact',
      artifactSeq: 1,
      stepId: 'FINAL',
      kind: 'screenshot',
      path: join(runDir, SCENARIO_ID, '001-FINAL-final-state.png'),
    },
    {
      type: 'artifact',
      artifactSeq: 1,
      stepId: 'FINAL',
      kind: 'ax',
      path: join(runDir, SCENARIO_ID, '001-FINAL-final-state.ax.json'),
    },
    { type: 'final-state', expected: 'wallet', actual: 'wallet', ok: true },
    { type: 'scenario.end', id: SCENARIO_ID, ok: true, durationMs: 10 },
    { type: 'suite.end', suite: 'full', durationMs: 20 },
    {
      type: 'run.end',
      runId: RUN_ID,
      passed: 1,
      failed: 0,
      skipped: 0,
      deferred: 0,
      durationMs: 20,
      funds: 'n/a',
      proof: 'product-run',
    },
  ].map((event, seq) => ({ ...event, seq, t: Date.parse(STARTED_AT) + seq }));
  writeFileSync(
    join(runDir, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  );
  writeFileSync(
    join(runDir, 'session-1.json'),
    JSON.stringify({
      version: 1,
      runId: `${RUN_ID}-01`,
      ephemeral: true,
      seedExport: false,
      scenarios: [SCENARIO_ID],
      simulator: {
        udid: 'synthetic',
        name: `Sovran E2E ${RUN_ID}-01-synthetic`,
        runtime: 'iOS 26.2',
        runtimeVersion: '26.2',
        deviceType: 'iPhone 17 Pro',
      },
    })
  );
  const scenarioDir = join(runDir, SCENARIO_ID);
  mkdirSync(scenarioDir);
  writeFileSync(join(scenarioDir, '001-FINAL-final-state.png'), 'synthetic png');
  writeFileSync(join(scenarioDir, '001-FINAL-final-state.ax.json'), '[]');
  return artifactsRoot;
}

function expectedPair(): ExpectedMatrixPair {
  return {
    scenarioId: SCENARIO_ID,
    platform: 'ios',
    driver: 'sim',
    lane: 'simulator',
    endState: 'wallet',
    fundedAssets: [],
  };
}

function writeFundedArtifacts(): string {
  const artifactsRoot = writeStrictArtifacts();
  const runDir = join(artifactsRoot, `run-${RUN_ID}`);
  const manifestPath = join(runDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.funded = {
    acceptedTestFundLoss: true,
    cocod: {
      bin: '/synthetic/cocod',
      source: 'path',
      version: '0.0.16',
      home: '/synthetic/.cocod',
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const sessionPath = join(runDir, 'session-1.json');
  const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
  session.seedExport = true;
  writeFileSync(sessionPath, JSON.stringify(session));

  rewriteEvents(artifactsRoot, (events) => {
    const scenarioBegin = events.find((event) => event.type === 'scenario.begin');
    if (scenarioBegin) scenarioBegin.lane = 'funded';
    const finalArtifactIndex = events.findIndex(
      (event) => event.type === 'artifact' && event.stepId === 'FINAL'
    );
    events.splice(
      finalArtifactIndex,
      0,
      { type: 'reconciliation.begin' },
      { type: 'reconciliation.end', ok: true, state: 'reconciled' }
    );
    const runEnd = events.find((event) => event.type === 'run.end');
    if (runEnd) runEnd.funds = 'reconciled';
    events.forEach((event, seq) => {
      event.seq = seq;
      event.t = Date.parse(STARTED_AT) + seq;
    });
  });

  const liabilityDir = join(runDir, 'session-1', 'funded-liability');
  mkdirSync(liabilityDir, { recursive: true });
  const entry = (kind: string, fields: Record<string, unknown>) => ({
    v: 1,
    runId: `${RUN_ID}-01`,
    legId: 'asset-01',
    ts: Date.parse(STARTED_AT),
    kind,
    ...fields,
  });
  const { maxPrincipal: expectedAmount, ...asset } = FUNDED_ASSET;
  const ledger = [
    entry('intent', {
      custody: { id: '0123456789abcdef', kind: 'mnemonic', len: 12, fingerprint: '0123456789ab' },
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount,
    }),
    entry('funded', { amount: 10, fees: 0 }),
    entry('sweep', {
      asset,
      ok: true,
      recoveredAmount: 10,
      residualAmount: 0,
      fees: 0,
    }),
    entry('reconciled', {
      fundedAmount: 10,
      recoveredAmount: 10,
      outflowAmount: 0,
      fees: 0,
    }),
  ];
  writeFileSync(
    join(liabilityDir, 'ledger.jsonl'),
    `${ledger.map((item) => JSON.stringify(item)).join('\n')}\n`
  );
  return artifactsRoot;
}

function writeAndroidArtifacts(): string {
  const artifactsRoot = writeStrictArtifacts();
  const runDir = join(artifactsRoot, `run-${RUN_ID}`);
  const manifestPath = join(runDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.driver = 'android';
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const sessionPath = join(runDir, 'session-1.json');
  const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
  delete session.simulator;
  const sessionRunId = `${RUN_ID}-01`;
  session.android = {
    serial: 'emulator-5554',
    avd: ownedAndroidAvdName(sessionRunId),
    avdRoot: join(realpathSync(tmpdir()), `${ownedAndroidAvdRootPrefix(sessionRunId)}ABC123`),
  };
  writeFileSync(sessionPath, JSON.stringify(session));
  return artifactsRoot;
}

function fundedEvidence() {
  const pair = { ...expectedPair(), lane: 'funded', fundedAssets: [FUNDED_ASSET] };
  const detail = run();
  detail.result!.funds = 'reconciled';
  detail.fundsSafeToDelete = true;
  detail.scenarios[0]!.lane = 'funded';
  const fundedCatalog = catalog();
  fundedCatalog[0]!.lane = 'funded';
  return { pair, detail, catalog: fundedCatalog };
}

function androidEvidence() {
  const pair = { ...expectedPair(), platform: 'android' as const, driver: 'android' as const };
  const detail = run();
  detail.driver = 'android';
  const androidCatalog = catalog();
  androidCatalog[0]!.platforms = ['android'];
  androidCatalog[0]!.runs[0]!.driver = 'android';
  return { pair, detail, catalog: androidCatalog };
}

function rewriteEvents(
  artifactsRoot: string,
  update: (events: Record<string, unknown>[]) => void
): void {
  const path = join(artifactsRoot, `run-${RUN_ID}`, 'events.jsonl');
  const events = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  update(events);
  writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

function auditArtifacts(artifactsRoot: string) {
  return auditFreshMatrixEvidence({
    cutoff: '2026-07-21T01:59:00.000Z',
    sourceFingerprint: SOURCE_FINGERPRINT,
    scenarioCount: 1,
    expectedPairs: [expectedPair()],
    catalog: catalog(),
    runs: [run()],
    artifactsRoot,
  });
}

function run(): RunDetail {
  return {
    runId: RUN_ID,
    suite: 'full',
    driver: 'sim',
    proof: 'product-run',
    startedAt: STARTED_AT,
    scenarioIds: [SCENARIO_ID],
    commitRun: false,
    label: 'synthetic',
    status: 'complete',
    result: {
      passed: 1,
      failed: 0,
      skipped: 0,
      deferred: 0,
      durationMs: 20,
      funds: 'n/a',
    },
    fundsSafeToDelete: true,
    scenarios: [
      {
        scenarioId: SCENARIO_ID,
        name: 'Wallet example',
        lane: 'simulator',
        ok: true,
        durationMs: 10,
        frames: [
          {
            artifactSeq: 1,
            stepId: 'FINAL',
            phase: 'FINAL',
            kind: 'final-state',
            file: `${SCENARIO_ID}/001-FINAL-final-state.png`,
            axFile: `${SCENARIO_ID}/001-FINAL-final-state.ax.json`,
          },
        ],
        named: [],
        finalState: { expected: 'wallet', actual: 'wallet', ok: true },
      },
    ],
  };
}

function catalog(): ScenarioCatalogEntry[] {
  return [
    {
      id: SCENARIO_ID,
      name: 'Wallet example',
      description: 'Synthetic audit scenario',
      lane: 'simulator',
      tags: [],
      platforms: ['ios'],
      facets: { checks: [], extras: [] },
      suites: ['full'],
      runs: [
        {
          runId: `run-${RUN_ID}`,
          label: 'synthetic',
          commitRun: false,
          startedAt: STARTED_AT,
          status: 'complete',
          proof: 'product-run',
          driver: 'sim',
          ok: true,
        },
      ],
    },
  ];
}

describe('auditFreshMatrixEvidence', () => {
  test('accepts a fresh, green product run with strict viewer and session evidence', async () => {
    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot: writeStrictArtifacts(),
    });

    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report).toMatchObject({ expected: 1, covered: 1, missing: [], complete: true });
    expect(report.coverage).toEqual([{ scenarioId: SCENARIO_ID, platform: 'ios', runId: RUN_ID }]);
  });

  test('accepts an ISO cutoff without fractional seconds', () => {
    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot: writeStrictArtifacts(),
    });

    expect(result._unsafeUnwrap()).toMatchObject({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      covered: 1,
    });
  });

  test('rejects a viewer timeline whose FINAL screenshot was deleted', () => {
    const artifactsRoot = writeStrictArtifacts();
    unlinkSync(join(artifactsRoot, `run-${RUN_ID}`, SCENARIO_ID, '001-FINAL-final-state.png'));

    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects a completed run whose JSONL has a malformed tail', () => {
    const artifactsRoot = writeStrictArtifacts();
    appendFileSync(join(artifactsRoot, `run-${RUN_ID}`, 'events.jsonl'), '{truncated');

    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({
      covered: 0,
      complete: false,
      missing: [{ scenarioId: SCENARIO_ID, platform: 'ios' }],
    });
  });

  test('rejects null or primitive raw JSON as evidence without throwing', () => {
    const corruptions = [
      (root: string) => writeFileSync(join(root, `run-${RUN_ID}`, 'manifest.json'), 'null'),
      (root: string) => {
        const path = join(root, `run-${RUN_ID}`, 'events.jsonl');
        const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
        lines[2] = 'null';
        writeFileSync(path, `${lines.join('\n')}\n`);
      },
      (root: string) => writeFileSync(join(root, `run-${RUN_ID}`, 'session-1.json'), '"primitive"'),
    ];

    for (const corrupt of corruptions) {
      const artifactsRoot = writeStrictArtifacts();
      corrupt(artifactsRoot);
      const result = auditArtifacts(artifactsRoot);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
    }
  });

  test('rejects null nested platform metadata without throwing', () => {
    const iosRoot = writeStrictArtifacts();
    const iosSessionPath = join(iosRoot, `run-${RUN_ID}`, 'session-1.json');
    const iosSession = JSON.parse(readFileSync(iosSessionPath, 'utf8')) as Record<string, unknown>;
    iosSession.simulator = null;
    writeFileSync(iosSessionPath, JSON.stringify(iosSession));

    const iosResult = auditArtifacts(iosRoot);
    expect(iosResult.isOk()).toBe(true);
    expect(iosResult._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });

    const androidRoot = writeAndroidArtifacts();
    const androidSessionPath = join(androidRoot, `run-${RUN_ID}`, 'session-1.json');
    const androidSession = JSON.parse(readFileSync(androidSessionPath, 'utf8')) as Record<
      string,
      unknown
    >;
    androidSession.android = null;
    writeFileSync(androidSessionPath, JSON.stringify(androidSession));
    const evidence = androidEvidence();

    const androidResult = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [evidence.pair],
      catalog: evidence.catalog,
      runs: [evidence.detail],
      artifactsRoot: androidRoot,
    });
    expect(androidResult.isOk()).toBe(true);
    expect(androidResult._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects an internal blank JSONL record', () => {
    const artifactsRoot = writeStrictArtifacts();
    const path = join(artifactsRoot, `run-${RUN_ID}`, 'events.jsonl');
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.replace('\n', '\n\n'));

    expect(auditArtifacts(artifactsRoot)._unsafeUnwrap()).toMatchObject({
      covered: 0,
      complete: false,
    });
  });

  test('rejects raw evidence with wrong versions, order, or nonmonotonic time', () => {
    const corruptions = [
      (root: string) => {
        const path = join(root, `run-${RUN_ID}`, 'manifest.json');
        const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        manifest.version = 2;
        writeFileSync(path, JSON.stringify(manifest));
      },
      (root: string) => {
        const path = join(root, `run-${RUN_ID}`, 'session-1.json');
        const session = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        session.version = 2;
        writeFileSync(path, JSON.stringify(session));
      },
      (root: string) =>
        rewriteEvents(root, (events) => {
          events[3]!.t = Number(events[2]!.t) - 1;
        }),
      (root: string) =>
        rewriteEvents(root, (events) => {
          const suiteEnd = events.find((event) => event.type === 'suite.end');
          if (suiteEnd) suiteEnd.suite = 'not-full';
        }),
      (root: string) =>
        rewriteEvents(root, (events) => {
          events.forEach((event) => {
            event.t = 1e20;
          });
        }),
    ];

    for (const corrupt of corruptions) {
      const artifactsRoot = writeStrictArtifacts();
      corrupt(artifactsRoot);
      expect(auditArtifacts(artifactsRoot)._unsafeUnwrap()).toMatchObject({
        covered: 0,
        complete: false,
      });
    }
  });

  test('rejects viewer FINAL evidence without matching raw artifact events', () => {
    const artifactsRoot = writeStrictArtifacts();
    rewriteEvents(artifactsRoot, (events) => {
      const index = events.findIndex(
        (event) => event.type === 'artifact' && event.stepId === 'FINAL' && event.kind === 'ax'
      );
      events.splice(index, 1);
      events.forEach((event, seq) => (event.seq = seq));
    });

    expect(auditArtifacts(artifactsRoot)._unsafeUnwrap()).toMatchObject({
      covered: 0,
      complete: false,
    });
  });

  test('accepts only run-bound Android evidence from a private owned AVD root', () => {
    const validRoot = writeAndroidArtifacts();
    const evidence = androidEvidence();
    const valid = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [evidence.pair],
      catalog: evidence.catalog,
      runs: [evidence.detail],
      artifactsRoot: validRoot,
    });
    expect(valid._unsafeUnwrap()).toMatchObject({ covered: 1, complete: true });

    for (const android of [
      {
        serial: 'emulator-5554',
        avd: ownedAndroidAvdName(`${RUN_ID}-01`),
        avdRoot: join(homedir(), '.android', 'sovran-e2e-android-avd-shared'),
      },
      {
        serial: 'emulator-5554',
        avd: 'Sovran_E2E_Unrelated',
        avdRoot: '/private/tmp/sovran-e2e-android-avd-synthetic',
      },
    ]) {
      const artifactsRoot = writeAndroidArtifacts();
      const sessionPath = join(artifactsRoot, `run-${RUN_ID}`, 'session-1.json');
      const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
      session.android = android;
      writeFileSync(sessionPath, JSON.stringify(session));
      const result = auditFreshMatrixEvidence({
        cutoff: '2026-07-21T01:59:00.000Z',
        sourceFingerprint: SOURCE_FINGERPRINT,
        scenarioCount: 1,
        expectedPairs: [evidence.pair],
        catalog: evidence.catalog,
        runs: [evidence.detail],
        artifactsRoot,
      });
      expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
    }
  });

  test('rejects a rollover cutoff date', () => {
    const result = auditFreshMatrixEvidence({
      cutoff: '2026-02-30T00:00:00Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot: writeStrictArtifacts(),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: 'invalid-cutoff' });
  });

  test('rejects a rollover run startedAt even when every evidence surface agrees', () => {
    const artifactsRoot = writeStrictArtifacts();
    const invalidStartedAt = '2026-02-30T02:00:00.000Z';
    const runDir = join(artifactsRoot, `run-${RUN_ID}`);
    const manifestPath = join(runDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.startedAt = invalidStartedAt;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    rewriteEvents(artifactsRoot, (events) => {
      events.forEach((event, seq) => {
        event.t = Date.parse(invalidStartedAt) + seq;
      });
    });
    const invalidRun = run();
    invalidRun.startedAt = invalidStartedAt;
    const invalidCatalog = catalog();
    invalidCatalog[0]!.runs[0]!.startedAt = invalidStartedAt;

    const result = auditFreshMatrixEvidence({
      cutoff: '2026-02-28T00:00:00Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: invalidCatalog,
      runs: [invalidRun],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects a raw run failure hidden by green parsed viewer data', () => {
    const artifactsRoot = writeStrictArtifacts();
    rewriteEvents(artifactsRoot, (events) => {
      const runEnd = events.find((event) => event.type === 'run.end');
      if (runEnd) runEnd.failed = 1;
    });

    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects funded evidence until funds are reconciled and safe to delete', () => {
    const artifactsRoot = writeStrictArtifacts();
    rewriteEvents(artifactsRoot, (events) => {
      const scenarioBegin = events.find((event) => event.type === 'scenario.begin');
      if (scenarioBegin) scenarioBegin.lane = 'funded';
    });
    const fundedPair = { ...expectedPair(), lane: 'funded', fundedAssets: [FUNDED_ASSET] };
    const fundedRun = run();
    fundedRun.fundsSafeToDelete = false;
    fundedRun.scenarios[0]!.lane = 'funded';
    const fundedCatalog = catalog();
    fundedCatalog[0]!.lane = 'funded';

    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [fundedPair],
      catalog: fundedCatalog,
      runs: [fundedRun],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('accepts funded evidence only with approved cocod and a reconciled liability ledger', () => {
    const artifactsRoot = writeFundedArtifacts();
    const evidence = fundedEvidence();
    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [evidence.pair],
      catalog: evidence.catalog,
      runs: [evidence.detail],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 1, complete: true });
  });

  test('rejects unapproved cocod source or version', () => {
    for (const cocodPatch of [{ source: 'fallback' }, { version: '1.0.0' }]) {
      const artifactsRoot = writeFundedArtifacts();
      const manifestPath = join(artifactsRoot, `run-${RUN_ID}`, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const funded = manifest.funded as { cocod: Record<string, unknown> };
      Object.assign(funded.cocod, cocodPatch);
      writeFileSync(manifestPath, JSON.stringify(manifest));
      const evidence = fundedEvidence();

      const result = auditFreshMatrixEvidence({
        cutoff: '2026-07-21T01:59:00.000Z',
        sourceFingerprint: SOURCE_FINGERPRINT,
        scenarioCount: 1,
        expectedPairs: [evidence.pair],
        catalog: evidence.catalog,
        runs: [evidence.detail],
        artifactsRoot,
      });

      expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
    }
  });

  test('binds every funded ledger intent to the exact authored asset and principal', () => {
    const corruptions = [
      (entry: Record<string, unknown>) => {
        if (entry.kind === 'intent' || entry.kind === 'sweep') {
          entry.asset = {
            ...FUNDED_ASSET,
            maxPrincipal: undefined,
            mintUrl: 'https://other.example',
          };
          delete (entry.asset as Record<string, unknown>).maxPrincipal;
        }
      },
      (entry: Record<string, unknown>) => {
        if (entry.kind === 'intent') entry.expectedAmount = 11;
        if (entry.kind === 'funded') entry.amount = 11;
        if (entry.kind === 'sweep') entry.recoveredAmount = 11;
        if (entry.kind === 'reconciled') {
          entry.fundedAmount = 11;
          entry.recoveredAmount = 11;
        }
      },
    ];

    for (const corrupt of corruptions) {
      const artifactsRoot = writeFundedArtifacts();
      const ledgerPath = join(
        artifactsRoot,
        `run-${RUN_ID}`,
        'session-1',
        'funded-liability',
        'ledger.jsonl'
      );
      const entries = readFileSync(ledgerPath, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      entries.forEach(corrupt);
      writeFileSync(ledgerPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
      const evidence = fundedEvidence();

      const result = auditFreshMatrixEvidence({
        cutoff: '2026-07-21T01:59:00.000Z',
        sourceFingerprint: SOURCE_FINGERPRINT,
        scenarioCount: 1,
        expectedPairs: [evidence.pair],
        catalog: evidence.catalog,
        runs: [evidence.detail],
        artifactsRoot,
      });

      expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
    }
  });

  test('rejects vacuous funded safety when the liability ledger is absent', () => {
    const artifactsRoot = writeFundedArtifacts();
    unlinkSync(
      join(artifactsRoot, `run-${RUN_ID}`, 'session-1', 'funded-liability', 'ledger.jsonl')
    );
    const evidence = fundedEvidence();
    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [evidence.pair],
      catalog: evidence.catalog,
      runs: [evidence.detail],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects blank, foreign-run, and unreconciled funded ledgers', () => {
    const corruptions = [
      (text: string) => text.replace('\n', '\n\n'),
      (text: string) =>
        `${text
          .trimEnd()
          .split('\n')
          .map((line) => JSON.stringify({ ...JSON.parse(line), runId: 'foreign-run' }))
          .join('\n')}\n`,
      (text: string) => `${text.trimEnd().split('\n').slice(0, -1).join('\n')}\n`,
    ];

    for (const corrupt of corruptions) {
      const artifactsRoot = writeFundedArtifacts();
      const ledgerPath = join(
        artifactsRoot,
        `run-${RUN_ID}`,
        'session-1',
        'funded-liability',
        'ledger.jsonl'
      );
      writeFileSync(ledgerPath, corrupt(readFileSync(ledgerPath, 'utf8')));
      const evidence = fundedEvidence();
      const result = auditFreshMatrixEvidence({
        cutoff: '2026-07-21T01:59:00.000Z',
        sourceFingerprint: SOURCE_FINGERPRINT,
        scenarioCount: 1,
        expectedPairs: [evidence.pair],
        catalog: evidence.catalog,
        runs: [evidence.detail],
        artifactsRoot,
      });

      expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
    }
  });

  test('rejects funded metadata and seed export on a nonfunded pair', () => {
    const artifactsRoot = writeStrictArtifacts();
    const runDir = join(artifactsRoot, `run-${RUN_ID}`);
    const manifestPath = join(runDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.funded = {
      acceptedTestFundLoss: true,
      cocod: { bin: 'cocod', source: 'path', version: '1.0.0', home: '/tmp/cocod' },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const sessionPath = join(runDir, 'session-1.json');
    const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
    session.seedExport = true;
    writeFileSync(sessionPath, JSON.stringify(session));
    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects a liability ledger hidden in an unpaired session directory', () => {
    const fundedRoot = writeFundedArtifacts();
    const ledgerText = readFileSync(
      join(fundedRoot, `run-${RUN_ID}`, 'session-1', 'funded-liability', 'ledger.jsonl'),
      'utf8'
    );
    const artifactsRoot = writeStrictArtifacts();
    const hiddenLedgerDir = join(artifactsRoot, `run-${RUN_ID}`, 'session-99', 'funded-liability');
    mkdirSync(hiddenLedgerDir, { recursive: true });
    writeFileSync(join(hiddenLedgerDir, 'ledger.jsonl'), ledgerText);

    const result = auditArtifacts(artifactsRoot);

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects an unresolved ledger hidden behind extra session metadata', () => {
    const artifactsRoot = writeFundedArtifacts();
    const runDir = join(artifactsRoot, `run-${RUN_ID}`);
    const firstIntent = readFileSync(
      join(runDir, 'session-1', 'funded-liability', 'ledger.jsonl'),
      'utf8'
    ).split('\n')[0]!;
    writeFileSync(join(runDir, 'session-99.json'), '{}');
    const hiddenLedgerDir = join(runDir, 'session-99', 'funded-liability');
    mkdirSync(hiddenLedgerDir, { recursive: true });
    writeFileSync(join(hiddenLedgerDir, 'ledger.jsonl'), `${firstIntent}\n`);
    const evidence = fundedEvidence();

    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [evidence.pair],
      catalog: evidence.catalog,
      runs: [evidence.detail],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects evidence captured before a source edit', () => {
    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: 'b'.repeat(64),
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot: writeStrictArtifacts(),
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });

  test('rejects legacy evidence without a source fingerprint', () => {
    const artifactsRoot = writeStrictArtifacts();
    const manifestPath = join(artifactsRoot, `run-${RUN_ID}`, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest.sourceFingerprint;
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = auditFreshMatrixEvidence({
      cutoff: '2026-07-21T01:59:00.000Z',
      sourceFingerprint: SOURCE_FINGERPRINT,
      scenarioCount: 1,
      expectedPairs: [expectedPair()],
      catalog: catalog(),
      runs: [run()],
      artifactsRoot,
    });

    expect(result._unsafeUnwrap()).toMatchObject({ covered: 0, complete: false });
  });
});

describe('loadWorkspaceFreshMatrixSource', () => {
  test('derives the current fixture-expanded full-suite platform matrix', async () => {
    const result = await loadWorkspaceFreshMatrixSource({
      captureSourceFingerprint: () => SOURCE_FINGERPRINT,
    });

    expect(result.isOk()).toBe(true);
    const source = result._unsafeUnwrap();
    expect(source.scenarioCount).toBe(129);
    expect(source.expectedPairs).toHaveLength(221);
    expect(source.expectedPairs.filter((pair) => pair.platform === 'ios')).toHaveLength(120);
    expect(source.expectedPairs.filter((pair) => pair.platform === 'android')).toHaveLength(101);
    expect(source.sourceFingerprint).toBe(SOURCE_FINGERPRINT);
  });

  test('reports all 221 pairs missing when the cutoff is in the future', async () => {
    const result = await runWorkspaceFreshMatrixAudit('2099-01-01T00:00:00.000Z', {
      captureSourceFingerprint: () => SOURCE_FINGERPRINT,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      scenarios: 129,
      expected: 221,
      covered: 0,
      complete: false,
    });
    expect(result._unsafeUnwrap().missing).toHaveLength(221);
  });

  test('rejects a source edit during raw evidence validation', async () => {
    const fingerprints = [SOURCE_FINGERPRINT, SOURCE_FINGERPRINT, 'b'.repeat(64)];
    const result = await runWorkspaceFreshMatrixAudit('2099-01-01T00:00:00.000Z', {
      captureSourceFingerprint: () => fingerprints.shift(),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: 'workspace-source' });
  });
});
