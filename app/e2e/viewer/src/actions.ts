import { api } from './api';
import { state, update, type JobView } from './state';
import { buildRunPlan } from '../lib/run-plan';
import type { DiffResult, TriggerRequest } from '../lib/types';

export async function refreshAll(): Promise<void> {
  const [runs, catalog] = await Promise.all([api.runs(), api.scenarios()]);
  update((current) => {
    current.runs = runs;
    current.catalog = catalog;
    current.error = undefined;
  });
}

/** Select a scenario, optionally in a specific run. `runId` is undefined for
 * scenarios with no runs yet — selection still enables "Rerun scenario".
 * Diff mode is sticky: picking a run/scenario in the left panel re-targets the
 * diff (B = that run, A = derived) instead of bouncing back to browse. */
export async function selectScenario(runId: string | undefined, scenarioId: string): Promise<void> {
  const stayInDiff = state.mode === 'diff';
  update((current) => {
    current.mode = stayInDiff ? 'diff' : 'browse';
    current.selectedRunId = runId;
    current.selectedScenarioId = scenarioId;
    current.playing = false;
    current.frameIndex = 0;
    current.runDetail = undefined;
  });
  if (stayInDiff && runId) retargetDiff(runId, scenarioId);
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
  const job: JobView = { id: jobId, kind, runIds: [], lines: [], status: 'running' };
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
        if (current.job?.id === jobId) {
          current.job.runId = runId;
          if (!current.job.runIds.includes(runId)) current.job.runIds.push(runId);
        }
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
  const plan = buildRunPlan(request, state.catalog);
  if ('error' in plan) {
    update((current) => {
      current.error = plan.error;
    });
    return;
  }

  update((current) => {
    current.modal = {
      kind: 'trigger',
      title,
      argvs: plan.argvs,
      funded: plan.funded,
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
              current2.diff.forRun = undefined;
              current2.diff.selectedScenarioId = undefined;
              current2.diff.pairIndex = 0;
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

/** Runs eligible for diffing: finished product runs with screenshots. */
function diffableRuns(): string[] {
  return state.runs
    .filter((run) => run.proof === 'product-run' && run.status === 'complete')
    .map((run) => `run-${run.runId}`);
}

function scenariosOf(runId: string): string[] {
  return state.runs.find((run) => `run-${run.runId}` === runId)?.scenarioIds ?? [];
}

/** The "previous run" for B: the nearest older eligible run containing
 * `preferScenarioId` when given, else one sharing any scenario with B
 * (single-scenario runs rarely overlap with their literal neighbour — an
 * all-added/removed diff says nothing), else plain adjacency.
 * state.runs is newest-first. */
function deriveDiffPair(runB: string, preferScenarioId?: string): string | undefined {
  const eligible = diffableRuns();
  const bIndex = eligible.indexOf(runB);
  if (bIndex < 0) return undefined;
  const older = eligible.slice(bIndex + 1);
  const bScenarios = new Set(scenariosOf(runB));
  return (
    (preferScenarioId
      ? older.find((id) => scenariosOf(id).includes(preferScenarioId))
      : undefined) ??
    older.find((id) => scenariosOf(id).some((scenario) => bScenarios.has(scenario))) ??
    older[0]
  );
}

/** Point the diff at a new B run (left-panel click while in diff mode). An
 * ineligible run clears to the picker empty state rather than silently keeping
 * a diff of something else. */
function retargetDiff(runId: string, scenarioId?: string): void {
  if (state.diff.runB === runId && state.diff.result) {
    // same pair — just focus the clicked scenario when the result covers it
    update((current) => {
      current.diff.forRun = runId;
      if (
        scenarioId &&
        current.diff.result?.scenarios.some((entry) => entry.scenarioId === scenarioId)
      ) {
        current.diff.selectedScenarioId = scenarioId;
        current.diff.pairIndex = 0;
      }
    });
    return;
  }
  const eligible = diffableRuns().includes(runId);
  const runA = eligible ? deriveDiffPair(runId, scenarioId) : undefined;
  update((current) => {
    current.diff.runB = eligible ? runId : undefined;
    current.diff.runA = runA;
    current.diff.forRun = runId;
    current.diff.result = undefined;
    current.diff.selectedScenarioId = undefined;
    current.diff.pairIndex = 0;
  });
  if (eligible && runA) void computeDiff(scenarioId);
}

/** Switch to the diff tab, defaulting to the selected run vs the previous one:
 * B = the browse selection when eligible (else the newest eligible run),
 * A = deriveDiffPair(B). Re-derives when the selection moved to a different
 * run since the diff was last targeted; manual picker choices (forRun cleared)
 * survive tab round-trips as long as the selection stays put. */
export function enterDiffMode(): void {
  update((current) => {
    current.mode = 'diff';
    current.playing = false;
  });
  if (state.diff.computing) return;
  const selected = state.selectedRunId;
  if (selected && diffableRuns().includes(selected) && selected !== state.diff.forRun) {
    retargetDiff(selected, state.selectedScenarioId);
    return;
  }
  if (state.diff.result || state.diff.runA || state.diff.runB) return;
  const runB = diffableRuns()[0];
  const runA = runB ? deriveDiffPair(runB) : undefined;
  if (!runA || !runB) return;
  update((current) => {
    current.diff.runA = runA;
    current.diff.runB = runB;
  });
  void computeDiff();
}

/** Compute (or load) the current A/B pair's diff. `preferScenarioId` opens the
 * result on that scenario when it's covered, else the biggest relevant change. */
export async function computeDiff(preferScenarioId?: string): Promise<void> {
  const { runA, runB } = state.diff;
  if (!runA || !runB) return;
  const openOn = (result: DiffResult | undefined): string | undefined =>
    preferScenarioId && result?.scenarios.some((entry) => entry.scenarioId === preferScenarioId)
      ? preferScenarioId
      : result?.scenarios[0]?.scenarioId;
  update((current) => {
    current.diff.result = undefined;
    current.diff.selectedScenarioId = undefined;
    current.diff.pairIndex = 0;
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
              current.diff.selectedScenarioId = openOn(result);
              current.diff.pairIndex = 0;
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
      current.diff.selectedScenarioId = openOn(result);
      current.diff.pairIndex = 0;
    });
  } catch (error) {
    update((current) => {
      current.diff.computing = undefined;
      current.error = String(error);
    });
  }
}
