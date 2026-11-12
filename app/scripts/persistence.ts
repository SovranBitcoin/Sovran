import { readFileSync, writeFileSync, existsSync, renameSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { executedSelection } from './persistence/report';
import { spawnSync, execFileSync } from 'node:child_process';
import { RELEASE_FIXTURES } from '../__tests__/releaseFixtures';
import {
  baselineCases,
  declaredCases,
  selectCases,
  CASE_DEFINITIONS,
} from '../__tests__/releaseFixtures/cases';
import { catalogSchema, mapRelease, easBuilds, retainHistory } from './persistence/releases';
import { corpusCoverage } from './persistence/coverage';
import { refreshCatalog, saveCatalog } from './persistence/refresh';

const root = resolve(import.meta.dir, '../..');
const catalogFile = join(root, 'app/__tests__/releaseFixtures/published.json');
const args = process.argv.slice(2);
const command = args.shift() ?? 'status';
const knownOptions = new Set(['--json', '--epoch', '--store', '--case', '--version', '--out']);
const options = new Map<string, string>();
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (!knownOptions.has(key) || options.has(key))
    throw new Error(`Unknown or duplicate option ${key}`);
  if (key === '--json') options.set(key, 'true');
  else {
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options.set(key, value);
  }
}
const emit = (value: unknown) =>
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
const filter = {
  epoch: options.get('--epoch'),
  store: options.get('--store'),
  case: options.get('--case'),
  version: options.get('--version'),
};

async function main() {
  if (command === 'refresh') {
    const previous = existsSync(catalogFile)
      ? catalogSchema.parse(JSON.parse(readFileSync(catalogFile, 'utf8')))
      : undefined;
    const catalog = await refreshCatalog(root, previous);
    saveCatalog(catalogFile, catalog);
    emit(
      `Saved ${catalog.observations.length} release observations. Inspect the diff; fixture data was not changed.`
    );
    return;
  }
  const catalog = catalogSchema.parse(JSON.parse(readFileSync(catalogFile, 'utf8')));
  const cases = [...baselineCases(), ...declaredCases()];
  const selected = command === 'scaffold' ? cases : selectCases(cases, filter);
  const releases = retainHistory(
    catalog.observations,
    easBuilds(readFileSync(join(root, 'docs/architecture/persistence/store-builds.tsv'), 'utf8'))
  ).map((release) => ({
    ...release,
    mapping: mapRelease(release, RELEASE_FIXTURES),
  }));
  const unmapped = releases.filter((release) => release.mapping.kind === 'unmapped');
  if (command === 'status') {
    const result = {
      candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      observedAt: catalog.observedAt,
      summary: {
        epochs: RELEASE_FIXTURES.length,
        cases: selected.length,
        publishedObservations: releases.filter((r) => r.evidence === 'published').length,
        installableObservations: releases.filter((r) => r.evidence === 'installable-build').length,
        ambiguousMappings: releases.filter(
          (r) => r.mapping.kind === 'version-candidates' && r.mapping.epochs.length > 1
        ).length,
        unmapped: unmapped.length,
        sourceCommitsUnavailableLocally: releases.filter((r) => r.sourceKnown === false).length,
      },
      sources: catalog.sources,
      cases: selected.map((item) => ({
        epoch: item.fixture.epoch,
        case: item.id,
        store: item.store,
        versions: item.fixture.versions,
        facts: item.fixture.survives.facts.length,
        rows: Object.keys(item.fixture.asyncStorage).length,
        knownGaps: item.fixture.knownGaps,
        stores: [...new Set(item.fixture.survives.facts.map((fact) => fact.store))].sort(),
        fieldEvidence: corpusCoverage(item.fixture).filter(
          (row) => !filter.store || row.store === filter.store
        ),
      })),
      releases,
      limits: [
        'Corpus/store coverage is not exhaustive field/value coverage.',
        'Ambiguous or pre-repository source histories remain unproven; no native or release certification is implied.',
      ],
    };
    if (options.has('--json')) emit(result);
    else {
      emit(
        `Candidate ${result.candidate}\n${result.summary.epochs} historical formats; ${selected.length} selected cases; ${unmapped.length} unmapped observations.`
      );
      for (const item of selected)
        emit(
          `${item.fixture.epoch}/${item.id} [${item.store}] versions=${item.fixture.versions.join(',')} facts=${item.fixture.survives.facts.length}`
        );
      emit(
        `Release evidence: ${result.summary.publishedObservations} publications, ${result.summary.installableObservations} installable builds, ${result.summary.ambiguousMappings} ambiguous mappings.\nUse --json for source limitations and all release mappings. Case coverage does not mean every field/value is covered.`
      );
    }
    if (unmapped.length) process.exitCode = 1;
    return;
  }
  if (command === 'scaffold') {
    const epoch = filter.epoch;
    const store = filter.store;
    const id = filter.case;
    if (!epoch || !store || !id) throw new Error('scaffold requires --epoch, --store and --case');
    const fixture = RELEASE_FIXTURES.find((item) => item.epoch === epoch);
    if (!fixture) throw new Error(`Unknown epoch ${epoch}`);
    if (CASE_DEFINITIONS.some((item) => item.epoch === epoch && item.id === id))
      throw new Error(`Case already exists: ${epoch}/${id}`);
    const rowKeys = Object.keys(fixture.asyncStorage).filter(
      (key) => key === store || key.startsWith(`${store}:profile:`)
    );
    if (!rowKeys.length)
      throw new Error(
        `No ${store} saved row in ${epoch}; consult the historical writer before choosing a renamed row.`
      );
    emit({
      id,
      epoch,
      store,
      source: {
        commit: fixture.commit,
        path: 'REPLACE_WITH_HISTORICAL_WRITER_PATH',
        reason: 'REPLACE_WITH_OLD_WRITER_EVIDENCE',
      },
      storageKey: rowKeys[0],
      preserve: { REPLACE_FIELD: 'REPLACE_WITH_HISTORICAL_INPUT' },
    });
    return;
  }
  if (command !== 'check') throw new Error('Use status, check, scaffold or refresh');
  for (const key of [
    'RELEASE_FIXTURE_FILE',
    'WRITE_UPGRADED_DISK',
    'WRITE_RELEASE_FIXTURE',
    'WRITE_E20_RECORDS',
  ]) {
    if (process.env[key])
      throw new Error(
        `Unset ${key} before persistence check; selection and fixture writing must be explicit.`
      );
  }

  if (unmapped.length)
    throw new Error(`Unmapped release observations: ${unmapped.map((item) => item.id).join(', ')}`);
  // Include the live TSV too: a newly recorded installable build cannot hide behind an old catalog.
  const fresh = easBuilds(
    readFileSync(join(root, 'docs/architecture/persistence/store-builds.tsv'), 'utf8')
  );
  for (const release of fresh)
    if (!mapRelease(release, RELEASE_FIXTURES).epochs.length)
      throw new Error(
        `Missing fixture for ${release.platform} ${release.version} build ${release.build}`
      );
  for (const declaration of CASE_DEFINITIONS.filter((item) =>
    selected.some((each) => each.id === item.id && each.fixture.epoch === item.epoch)
  )) {
    const historicalPath = declaration.source.path.replace(/:\d+(?:-\d+)?$/, '');
    try {
      execFileSync('git', ['cat-file', '-e', `${declaration.source.commit}:${historicalPath}`], {
        cwd: root,
        stdio: 'ignore',
        timeout: 10_000,
      });
    } catch {
      throw new Error(
        `Historical source not found for ${declaration.epoch}/${declaration.id}: ${declaration.source.commit}:${historicalPath}`
      );
    }
  }
  const baselines = selected.some((item) => item.id === 'baseline');
  const variants = selected.some((item) => item.id !== 'baseline');
  const files = [
    ...(baselines ? ['__tests__/releaseFixtures.test.ts'] : []),
    ...(variants ? ['__tests__/releaseFixtureRestoreInFlight.test.ts'] : []),
    '__tests__/persistenceCasesDeclaration.test.ts',
    '__tests__/persistenceReleases.test.ts',
    '__tests__/persistenceCoverage.test.ts',
    '__tests__/persistenceFreeze.test.ts',
    '__tests__/persistenceReport.test.ts',
    '__tests__/persistenceCli.test.ts',
    '__tests__/releaseFixturesFrozen.test.ts',
    '__tests__/releaseFixturesCompleteness.test.ts',
  ];
  const out =
    options.get('--out') ?? join(mkdtempSync(join(tmpdir(), 'sovran-persistence-')), 'report.json');
  const freshReport = `${resolve(out)}.${randomUUID()}.pending`;
  const run = spawnSync(
    'bun',
    [
      'run',
      'test',
      '--',
      ...files,
      '--runInBand',
      ...(freshReport ? ['--json', '--outputFile', freshReport] : []),
    ],
    {
      cwd: join(root, 'app'),
      stdio: 'inherit',
      env: {
        ...process.env,
        PERSISTENCE_EPOCH: filter.epoch ?? '',
        PERSISTENCE_STORE: filter.store ?? '',
        PERSISTENCE_CASE: filter.case ?? '',
        PERSISTENCE_VERSION: filter.version ?? '',
        PERSISTENCE_SELECTION: !baselines ? 'variants' : !variants ? 'baselines' : 'all',
      },
    }
  );
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
  if (out && freshReport) {
    if (!existsSync(freshReport))
      throw new Error(
        'Test process produced no fresh report; any previous report remains historical.'
      );
    const raw: unknown = JSON.parse(readFileSync(freshReport, 'utf8'));
    if (typeof raw !== 'object' || raw === null) throw new Error('Unexpected Jest report');
    const selection = executedSelection(raw, selected);
    if (!selection.complete || !selection.success) process.exitCode = 1;
    writeFileSync(
      freshReport,
      `${JSON.stringify(
        {
          ...raw,
          success: selection.complete && selection.success && run.status === 0,
          persistence: {
            candidate: execFileSync('git', ['rev-parse', 'HEAD'], {
              cwd: root,
              encoding: 'utf8',
            }).trim(),
            catalogObservedAt: catalog.observedAt,
            workingTreeDirty:
              execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
                .length > 0,
            filter,
            selection,
            cases: selected.map((item) => ({
              epoch: item.fixture.epoch,
              case: item.id,
              store: item.store,
              observations: releases.filter((release) =>
                release.mapping.epochs.includes(item.fixture.epoch)
              ),
            })),
          },
        },
        null,
        2
      )}\n`
    );
    renameSync(freshReport, resolve(out));
    emit(`Machine-readable Jest report: ${resolve(out)}`);
  }
}
main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
