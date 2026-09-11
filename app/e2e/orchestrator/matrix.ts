/**
 * Chunk-plan builder for the cross-platform suite orchestrator.
 *
 * A chunk is one session group of the `full` suite targeted at one platform:
 * the smallest unit `cli.ts run --scenario <target>` can execute while
 * preserving `newInstance` chaining (selection expands the target to its
 * whole dependency prefix). Chunk-sized runs are what the fresh-matrix audit
 * can accept as evidence — it rejects any run containing a failure or skip,
 * so a monolithic full-suite run can never go green while one scenario flakes.
 */
import { err, ok, type Result } from 'neverthrow';

import { loadE2E, type Loaded } from '../core/loader';
import { effectiveRequirements } from '../core/plan';
import { selectSuiteScenarios } from '../core/selection';
import { PLATFORM_DRIVERS, scenarioPlatforms, type Platform } from '../schema/capabilities';
import { E2E_ROOT } from '../viewer/lib/paths';

/** Same key shape the fresh-matrix audit uses for (scenario, platform). */
export const pairKey = (scenarioId: string, platform: Platform): string =>
  `${scenarioId}|${platform}`;

export interface ChunkPlanEntry {
  /** `${platform}:${targetScenarioId}` — stable across campaigns. */
  chunkId: string;
  platform: Platform;
  driver: 'sim' | 'android';
  /** Last member of the session group; `--scenario` target so the whole
   * group runs as its dependency prefix. */
  targetScenarioId: string;
  /** Every group member in suite order (including platform-unsupported
   * members, which defer at run time — never a silent skip). */
  memberIds: string[];
  /** Members this platform actually executes; the pairs this chunk proves. */
  supportedMemberIds: string[];
  /** pairKey() for each supported member. */
  expectedPairKeys: string[];
  /** True when ANY selected member is funded lane — the child CLI's
   * selection-sensitive authorization triggers even for deferring members. */
  funded: boolean;
}

export interface ChunkPlan {
  suite: 'full';
  scenarioCount: number;
  /** All (scenario, platform) pairs of the full matrix, before lane narrowing. */
  expectedPairKeys: string[];
  /** Ordered execution list: platforms in the requested order, suite order within. */
  chunks: ChunkPlanEntry[];
}

interface ChunkPlanOptions {
  /** Execution order, e.g. ['ios', 'android']. */
  platforms: Platform[];
  /** Narrow to chunks containing at least one member of this lane. */
  lane?: string;
  /** Injected for tests; defaults to loading the real authoring tree. */
  loaded?: Loaded;
}

/** Matches the fresh-matrix invariant guard — bump both together when the
 * full suite grows. */
const EXPECTED_SCENARIOS = 129;
const EXPECTED_PAIRS = 221;

export function buildChunkPlan(options: ChunkPlanOptions): Result<ChunkPlan, string> {
  if (options.platforms.length === 0) return err('no platforms selected');
  if (new Set(options.platforms).size !== options.platforms.length) {
    return err('duplicate platforms selected');
  }

  const loaded = options.loaded ?? loadE2E(E2E_ROOT);
  if (loaded.issues.length > 0) {
    return err(`e2e authoring has ${loaded.issues.length} validation issue(s) — run e2e:validate`);
  }

  let selection: ReturnType<typeof selectSuiteScenarios>;
  try {
    selection = selectSuiteScenarios(loaded.suites, loaded.scenarios, { suite: 'full' });
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : String(cause));
  }

  const platformsById = new Map(
    selection.scenarios.map((scenario) => [
      scenario.id,
      scenarioPlatforms(effectiveRequirements(scenario, loaded.fixtures)),
    ])
  );
  const expectedPairKeys = selection.scenarios.flatMap((scenario) =>
    (platformsById.get(scenario.id) ?? []).map((platform) => pairKey(scenario.id, platform))
  );
  if (
    selection.scenarios.length !== EXPECTED_SCENARIOS ||
    expectedPairKeys.length !== EXPECTED_PAIRS
  ) {
    return err(
      `full matrix drifted: ${selection.scenarios.length} scenarios, ${expectedPairKeys.length} pairs (expected ${EXPECTED_SCENARIOS}/${EXPECTED_PAIRS})`
    );
  }
  if (new Set(expectedPairKeys).size !== expectedPairKeys.length) {
    return err('full matrix contains duplicate scenario/platform pairs');
  }

  const chunks: ChunkPlanEntry[] = [];
  for (const platform of options.platforms) {
    for (const group of selection.sessionGroups) {
      const members = group.map(({ scenario }) => scenario);
      if (options.lane && !members.some((member) => member.lane === options.lane)) continue;
      const supported = members.filter((member) =>
        (platformsById.get(member.id) ?? []).includes(platform)
      );
      if (supported.length === 0) continue;
      const target = members.at(-1)!;
      chunks.push({
        chunkId: `${platform}:${target.id}`,
        platform,
        driver: PLATFORM_DRIVERS[platform],
        targetScenarioId: target.id,
        memberIds: members.map((member) => member.id),
        supportedMemberIds: supported.map((member) => member.id),
        expectedPairKeys: supported.map((member) => pairKey(member.id, platform)),
        funded: members.some((member) => member.lane === 'funded'),
      });
    }
  }
  if (chunks.length === 0) return err('chunk plan selected zero chunks');

  return ok({
    suite: 'full',
    scenarioCount: selection.scenarios.length,
    expectedPairKeys,
    chunks,
  });
}

/** The exact child CLI invocation for one chunk. Safety flags are forwarded
 * from operator consent, never synthesized. */
export function chunkArgv(
  chunk: ChunkPlanEntry,
  options: { acceptTestFundLoss: boolean; noRecord: boolean }
): string[] {
  const argv = [
    'bun',
    'e2e/cli.ts',
    'run',
    '--driver',
    chunk.driver,
    '--i-approve-destructive-reset',
    '--suite',
    'full',
    '--scenario',
    chunk.targetScenarioId,
  ];
  if (chunk.funded && options.acceptTestFundLoss) argv.push('--i-accept-test-fund-loss');
  if (options.noRecord) argv.push('--no-record');
  return argv;
}
