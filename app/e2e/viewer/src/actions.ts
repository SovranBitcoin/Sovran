import { api } from './api';
import { state, update, type JobView } from './state';
import type { TriggerRequest } from '../lib/types';

export async function refreshAll(): Promise<void> {
  const [runs, catalog] = await Promise.all([api.runs(), api.scenarios()]);
  update((current) => {
    current.runs = runs;
    current.catalog = catalog;
    current.error = undefined;
  });
}

/** Select a scenario, optionally in a specific run. `runId` is undefined for
 * scenarios with no runs yet — selection still enables "Rerun scenario". */
export async function selectScenario(runId: string | undefined, scenarioId: string): Promise<void> {
  update((current) => {
    current.mode = 'browse';
    current.selectedRunId = runId;
    current.selectedScenarioId = scenarioId;
    current.playing = false;
    current.frameIndex = 0;
    current.runDetail = undefined;
  });
  if (!runId) return;
  try {
    const detail = await api.run(runId);
    update((current) => {
      if (current.selectedRunId === runId) current.runDetail = detail;
    });
  } catch (error) {
    update((current) => {
      current.error = String(error);
    });
  }
}

/** Hop the currently selected scenario to another run (version dropdown). */
export function selectVersion(runId: string): void {
  if (state.selectedScenarioId) void selectScenario(runId, state.selectedScenarioId);
}

/** Load (or reload) the Pages gallery index. */
export async function loadPages(allRuns = state.pages.allRuns): Promise<void> {
  update((current) => {
    current.pages.allRuns = allRuns;
    current.pages.loading = true;
  });
  try {
    const index = await api.pages(allRuns);
    update((current) => {
      if (current.pages.allRuns === allRuns) {
        current.pages.index = index;
        current.pages.loading = false;
      }
      current.error = undefined;
    });
  } catch (error) {
    update((current) => {
      current.pages.loading = false;
      current.error = String(error);
    });
  }
}

function attachJob(jobId: string, kind: JobView['kind']): void {
  const job: JobView = { id: jobId, kind, lines: [], status: 'running' };
  update((current) => {
    current.job = job;
    current.modal = undefined;
  });
  api.stream(jobId, {
    open: () =>
      update((current) => {
        if (current.job?.id === jobId) current.job.lines = [];
      }),
    line: (line) =>
      update((current) => {
        if (current.job?.id === jobId) current.job.lines.push(line);
      }),
    runDiscovered: (runId) =>
      update((current) => {
        if (current.job?.id === jobId) current.job.runId = runId;
      }),
    progress: (progress) =>
      update((current) => {
        if (current.diff.computing) current.diff.computing = progress;
      }),
    exit: (code) => {
      update((current) => {
        if (current.job?.id === jobId) {
          current.job.status = 'exited';
          current.job.exitCode = code;
        }
      });
      void refreshAll().then(() => {
        const runId = state.job?.runId;
        const scenarioId = state.selectedScenarioId;
        if (kind === 'run' && runId && code === 0) {
          const run = state.runs.find((candidate) => `run-${candidate.runId}` === runId);
          const scenario =
            scenarioId && run?.scenarioIds.includes(scenarioId) ? scenarioId : run?.scenarioIds[0];
          if (scenario) void selectScenario(runId, scenario);
        }
      });
    },
  });
}

/** Open the confirm modal for a run trigger; sends on confirmation. */
export function requestTrigger(request: TriggerRequest, title: string): void {
  const fundedIds = new Set(
    state.catalog.filter((entry) => entry.lane === 'funded').map((entry) => entry.id)
  );
  let funded = false;
  const argv = ['bun', 'e2e/cli.ts', 'run', '--driver', 'sim', '--i-approve-destructive-reset'];
  if (request.kind === 'scenario') {
    argv.push('--suite', 'full', '--scenario', request.scenarioId);
    funded = fundedIds.has(request.scenarioId);
  } else {
    const suite = request.kind === 'suite' ? request.suite : (request.suite ?? 'default');
    argv.push('--suite', suite);
    funded =
      suite === 'full'
        ? fundedIds.size > 0
        : state.catalog.some(
            (entry) => entry.lane === 'funded' && entry.suites.includes('default')
          );
  }
  if (request.kind === 'commit-run') argv.push('--require-clean-git');

  update((current) => {
    current.modal = {
      kind: 'trigger',
      title,
      argv,
      funded,
      send: (acceptFundLoss) => {
        void api
          .trigger({ ...request, acceptFundLoss })
          .then((response) => attachJob(response.jobId, 'run'))
          .catch((error) =>
            update((current2) => {
              current2.modal = undefined;
              current2.error = String(error);
            })
          );
      },
    };
  });
}

export function requestClear(): void {
  const skipped = state.runs
    .filter((run) => !run.fundsSafeToDelete || run.status === 'in-progress')
    .map((run) => `run-${run.runId}`);
  update((current) => {
    current.modal = {
      kind: 'clear',
      skipped,
      send: () => {
        void api
          .clear()
          .then(() =>
            update((current2) => {
              current2.modal = undefined;
              current2.selectedRunId = undefined;
              current2.selectedScenarioId = undefined;
              current2.runDetail = undefined;
              current2.diff.result = undefined;
              current2.diff.runA = undefined;
              current2.diff.runB = undefined;
            })
          )
          .then(refreshAll)
          .catch((error) =>
            update((current2) => {
              current2.modal = undefined;
              current2.error = String(error);
            })
          );
      },
    };
  });
}

export async function computeDiff(): Promise<void> {
  const { runA, runB } = state.diff;
  if (!runA || !runB) return;
  update((current) => {
    current.diff.result = undefined;
    current.diff.selectedScenarioId = undefined;
    current.diff.selectedPairKey = undefined;
    current.diff.computing = 'starting';
  });
  try {
    const response = await api.diff(runA, runB);
    if (!response.cached && response.jobId) {
      attachJob(response.jobId, 'diff');
      // poll until the result file lands (exit event also triggers refresh)
      const poll = setInterval(() => {
        void api.diffResult(response.key).then((result) => {
          if (result) {
            clearInterval(poll);
            update((current) => {
              current.diff.result = result;
              current.diff.computing = undefined;
            });
          }
        });
      }, 1_000);
      return;
    }
    const result = await api.diffResult(response.key);
    update((current) => {
      current.diff.result = result;
      current.diff.computing = undefined;
    });
  } catch (error) {
    update((current) => {
      current.diff.computing = undefined;
      current.error = String(error);
    });
  }
}
