/**
 * The startup stage graph, owned by the app runtime rather than a React
 * context.
 *
 * Each owner registers its stage from `STAGES` via `useInitializationStage`.
 * A stage declares its dependencies (`dependsOn`) and whether it is
 * **blocking** (default) or **non-blocking**.
 *
 *  - **Blocking** stages keep the splash screen visible. The app renders only
 *    after every blocking stage completes.
 *  - **Non-blocking** stages (`blocking: false`) run in the background and do
 *    not contribute to `isInitializing`.
 *
 * `NativeSplashLayoutGate` reads `isInitializing` and hides the native splash
 * once it flips false and the root view has laid out. Profile transitions hold
 * the splash through `initializationStages.resetStages`.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { initLog, log } from '@/shared/lib/logger';

initLog('Module', 'initializationStages loaded');

type StageStatus = 'pending' | 'loading' | 'complete' | 'error';

/** How a stage sits in the startup graph. */
interface StageConfig {
  /** IDs of stages that must complete before this one can start. */
  dependsOn?: readonly string[];
  /**
   * When `true` (the default), the splash screen stays visible until this
   * stage completes. Set to `false` for work that can happen after the app
   * is already visible (e.g. relay connections, recovery operations).
   */
  blocking?: boolean;
  /**
   * Set by a stage whose owner sits above the account scope, so it stays
   * mounted across an in-process profile switch and never registers again.
   * Such a stage keeps its status through a reset that asks to keep them;
   * dropping it would leave every stage that depends on it waiting forever.
   */
  outlivesAccount?: boolean;
}

/** The startup stages, keyed by id, with the owner that registers each. */
const STAGES = {
  /** GlobalMigrationGate, mounted above the account scope. */
  'global-migrations': { outlivesAccount: true },
  /** NostrKeysProvider. */
  nostr: { dependsOn: ['global-migrations'] },
  /** WalletCore: opening the wallet. */
  coco: { dependsOn: ['nostr'] },
  /** WalletCore: background work once the wallet is open. */
  'coco-background': { dependsOn: ['coco'], blocking: false },
  /** The account's Nostr client. */
  'nostr-client': { dependsOn: ['coco'], blocking: false },
} as const satisfies Record<string, StageConfig>;

type StageId = keyof typeof STAGES;

interface Stage {
  id: string;
  status: StageStatus;
  dependsOn?: readonly string[];
  /** When true (the default), this stage must complete before the app renders. */
  blocking: boolean;
  outlivesAccount: boolean;
}

interface ResetStagesOptions {
  /**
   * Keep stages registered above the account scope. An in-process profile
   * switch passes this; a switch that restarts the runtime does not need it.
   */
  keepStagesThatOutliveAccount?: boolean;
}

interface StageGraph {
  stages: ReadonlyMap<string, Stage>;
  /**
   * Set by a reset and cleared once any stage exists again (see
   * `useInitializationState`), or by a cancel. It covers the gap after a reset
   * in which no stage exists yet and the app would otherwise look initialised.
   */
  awaitingStages: boolean;
}

let graph: StageGraph = { stages: new Map(), awaitingStages: false };
const listeners = new Set<() => void>();
// When each stage first left 'pending', so its duration can be logged.
const stageStartTimes = new Map<string, number>();
let lastLoggedInitializing: boolean | null = null;

function isInitializingIn(g: StageGraph): boolean {
  if (g.awaitingStages) return true;
  for (const stage of g.stages.values()) {
    if (stage.blocking && (stage.status === 'loading' || stage.status === 'pending')) return true;
  }
  return false;
}

function hasFailedStageIn(g: StageGraph): boolean {
  for (const stage of g.stages.values()) {
    if (stage.blocking && stage.status === 'error') return true;
  }
  return false;
}

function canStageStartIn(g: StageGraph, id: string): boolean {
  const stage = g.stages.get(id);
  // Not registered yet: don't let it start prematurely, which would flicker
  // isInitializing false→true when a blocking stage registers one render
  // after its dependency completes.
  if (!stage) return false;
  if (!stage.dependsOn || stage.dependsOn.length === 0) return true;
  return stage.dependsOn.every((depId) => g.stages.get(depId)?.status === 'complete');
}

function commit(next: StageGraph): void {
  if (next === graph) return;
  graph = next;
  const isInitializing = isInitializingIn(next);
  if (lastLoggedInitializing !== isInitializing) {
    const blockingStages = Array.from(next.stages.values())
      .filter((s) => s.blocking)
      .map((s) => `${s.id}=${s.status}`)
      .join(', ');
    initLog(
      'isInitializing',
      `${String(lastLoggedInitializing)} → ${String(isInitializing)} | blocking=[${blockingStages}]`
    );
    lastLoggedInitializing = isInitializing;
  }
  log.debug('init.provider.state', {
    totalStages: next.stages.size,
    isInitializing,
    stages: Array.from(next.stages.entries()).map(([id, s]) => ({ id, status: s.status })),
  });
  listeners.forEach((listener) => listener());
}

function registerStage(id: StageId): void {
  const config: StageConfig = STAGES[id];
  const isBlocking = config.blocking !== false;
  initLog(
    'registerStage',
    `${id} (blocking=${isBlocking}, dependsOn=${config.dependsOn?.join(',') ?? 'none'})`
  );
  if (graph.stages.has(id)) return;
  const stages = new Map(graph.stages);
  stages.set(id, {
    id,
    status: 'pending',
    dependsOn: config.dependsOn,
    blocking: isBlocking,
    outlivesAccount: config.outlivesAccount === true,
  });
  commit({ ...graph, stages });
}

function updateStage(
  id: string,
  updates: { message?: string; status?: StageStatus; error?: string }
) {
  initLog('updateStage', `${id} status=${updates.status ?? '-'} msg=${updates.message ?? '-'}`);
  const stage = graph.stages.get(id);
  if (!stage || !updates.status || updates.status === stage.status) return;

  // Per-stage start→end duration: the first transition out of 'pending' is
  // the start; reaching 'complete' or 'error' logs how long the step took,
  // separate from time spent waiting on dependencies.
  const nowMs = Date.now();
  if (stage.status === 'pending' && !stageStartTimes.has(id)) {
    stageStartTimes.set(id, nowMs);
    initLog('stageStart', `${id} → ${updates.status}`);
  }
  if (updates.status === 'complete' || updates.status === 'error') {
    const startedAt = stageStartTimes.get(id);
    const durationMs = startedAt ? nowMs - startedAt : -1;
    initLog(
      'stageEnd',
      updates.status === 'complete'
        ? `${id} complete durationMs=${durationMs}`
        : `${id} error durationMs=${durationMs} msg=${updates.error ?? '-'}`
    );
  }
  const stages = new Map(graph.stages);
  stages.set(id, { ...stage, status: updates.status });
  commit({ ...graph, stages });
}

/** Ends the post-reset wait once stages exist again. */
function endAwaitIfStagesExist(): void {
  if (graph.awaitingStages && graph.stages.size > 0) commit({ ...graph, awaitingStages: false });
}

/**
 * The controls a profile transition uses: clear the stages so the splash shows
 * again until the account scope re-registers them, or cancel a held reset
 * when the switch aborts before any stage registers.
 */
export const initializationStages = {
  resetStages(options?: ResetStagesOptions): void {
    const keep = options?.keepStagesThatOutliveAccount === true;
    log.info('init.provider.reset_stages', { keepStagesThatOutliveAccount: keep });
    const kept = new Map<string, Stage>();
    // Iterated with forEach, not spread: the React Native Babel preset
    // compiles array spread loosely, and spreading a Map there does not yield
    // its entries.
    if (keep) {
      graph.stages.forEach((stage, id) => {
        if (stage.outlivesAccount) kept.set(id, stage);
      });
    }
    stageStartTimes.clear();
    commit({ stages: kept, awaitingStages: true });
  },
  cancelResetStages(): void {
    if (graph.awaitingStages) commit({ ...graph, awaitingStages: false });
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getGraph = () => graph;

export function useInitializationState() {
  const current = useSyncExternalStore(subscribe, getGraph, getGraph);
  // The wait ends after the render that showed it, as it did when this lived
  // in a provider effect: a reset that kept its long-lived stages still
  // raises the splash for one commit.
  useEffect(() => {
    if (current.awaitingStages && current.stages.size > 0) endAwaitIfStagesExist();
  }, [current]);
  return { isInitializing: isInitializingIn(current), hasFailedStage: hasFailedStageIn(current) };
}

export function useInitializationStage(stageId: StageId) {
  const getCanStart = useCallback(() => canStageStartIn(graph, stageId), [stageId]);
  const canStart = useSyncExternalStore(subscribe, getCanStart, getCanStart);
  const hasRegistered = useRef(false);

  useEffect(() => {
    if (hasRegistered.current) return;
    hasRegistered.current = true;
    registerStage(stageId);
  }, [stageId]);

  const stageLog = useCallback(
    (message: string) => updateStage(stageId, { message, status: 'loading' }),
    [stageId]
  );
  const complete = useCallback(() => updateStage(stageId, { status: 'complete' }), [stageId]);
  const error = useCallback(
    (errorMessage: string) => updateStage(stageId, { status: 'error', error: errorMessage }),
    [stageId]
  );

  // The gap between a dependency completing and this stage seeing canStart.
  const prevCanStart = useRef(false);
  useEffect(() => {
    if (canStart && !prevCanStart.current) {
      initLog('useStage', `${stageId} canStart flipped to true`);
    }
    prevCanStart.current = canStart;
  }, [canStart, stageId]);

  // Stable identity: changes only when `canStart` flips, so consumers can
  // depend on the whole `stage` without their effects re-running every render.
  return useMemo(
    () => ({ log: stageLog, complete, error, canStart }),
    [stageLog, complete, error, canStart]
  );
}
