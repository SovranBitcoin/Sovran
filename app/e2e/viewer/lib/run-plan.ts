import { LANES, PLATFORMS, PLATFORM_DRIVERS, type Platform } from '../../schema/capabilities';
import type { ScenarioCatalogEntry, TriggerRequest } from './types';

export interface RunPlan {
  argvs: string[][];
  funded: boolean;
  platforms: Platform[];
}

/** Expand one viewer trigger into one product run per supported platform.
 * Platform support comes from the same capability-derived catalog chips the
 * operator sees; the CLI still owns one driver and one artifact dir per run. */
export function buildRunPlan(
  request: TriggerRequest,
  catalog: readonly ScenarioCatalogEntry[]
): RunPlan | { error: string } {
  let selected: ScenarioCatalogEntry[];
  let selectionArgs: string[];

  if (request.kind === 'scenario') {
    const scenario = catalog.find((entry) => entry.id === request.scenarioId);
    if (!scenario) return { error: 'unknown scenario' };
    selected = [scenario];
    selectionArgs = ['--suite', 'full', '--scenario', request.scenarioId];
  } else {
    const suite = request.kind === 'suite' ? request.suite : (request.suite ?? 'default');
    if (suite !== 'default' && suite !== 'full') return { error: 'unknown suite' };
    selected = catalog.filter((entry) => entry.suites.includes(suite));
    if (selected.length === 0) return { error: `suite "${suite}" selected zero scenarios` };
    selectionArgs = ['--suite', suite];
  }

  const platforms = PLATFORMS.filter((platform) =>
    selected.some((entry) => entry.platforms.includes(platform))
  );
  if (platforms.length === 0) return { error: 'selection has no supported platforms' };

  const argvs = platforms.flatMap((platform) => {
    const lanes =
      request.kind === 'scenario'
        ? [undefined]
        : LANES.filter((lane) =>
            selected.some((entry) => entry.lane === lane && entry.platforms.includes(platform))
          );
    return lanes.map((lane) => {
      const argv = [
        'bun',
        'e2e/cli.ts',
        'run',
        '--driver',
        PLATFORM_DRIVERS[platform],
        '--i-approve-destructive-reset',
        ...selectionArgs,
        ...(lane ? ['--lane', lane] : []),
      ];
      if (request.kind === 'commit-run') argv.push('--require-clean-git');
      const fundedCommand =
        lane === 'funded' ||
        (lane === undefined &&
          selected.some((entry) => entry.lane === 'funded' && entry.platforms.includes(platform)));
      if (request.acceptFundLoss === true && fundedCommand) {
        argv.push('--i-accept-test-fund-loss');
      }
      return argv;
    });
  });

  return {
    argvs,
    funded: selected.some(
      (entry) => entry.lane === 'funded' && entry.platforms.some((p) => platforms.includes(p))
    ),
    platforms,
  };
}
