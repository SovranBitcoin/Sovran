import type {
  DiffResult,
  PagesIndex,
  RunDetail,
  RunSummary,
  ScenarioCatalogEntry,
} from '../lib/types';

export interface JobView {
  id: string;
  kind: 'run' | 'diff';
  runId?: string;
  lines: string[];
  status: 'running' | 'exited';
  exitCode?: number;
  /** First kill click arms the button; the second one actually kills. */
  killArmed?: boolean;
}

export type ModalView =
  | {
      kind: 'trigger';
      title: string;
      argv: string[];
      funded: boolean;
      send: (acceptFundLoss: boolean) => void;
    }
  | { kind: 'clear'; skipped: string[]; send: () => void };

export interface AppState {
  mode: 'browse' | 'diff' | 'pages';
  runs: RunSummary[];
  catalog: ScenarioCatalogEntry[];
  selectedRunId?: string;
  selectedScenarioId?: string;
  runDetail?: RunDetail;
  frameIndex: number;
  playing: boolean;
  showAllPhases: boolean;
  /** Play the scenario's test+verify screen recording instead of the frame reel. */
  videoMode: boolean;
  diff: {
    runA?: string;
    runB?: string;
    result?: DiffResult;
    computing?: { done: number; total: number } | 'starting';
    selectedScenarioId?: string;
    selectedPairKey?: string;
    view: 'side-by-side' | 'overlay';
    overlayOpacity: number;
    overlayHeatmap: boolean;
  };
  pages: {
    index?: PagesIndex;
    allRuns: boolean;
    loading?: boolean;
    /** Page name expanded to full-width thumbnails; others render collapsed. */
    selectedPage?: string;
  };
  job?: JobView;
  modal?: ModalView;
  error?: string;
}

export const state: AppState = {
  mode: 'browse',
  runs: [],
  catalog: [],
  frameIndex: 0,
  playing: false,
  showAllPhases: false,
  videoMode: false,
  diff: { view: 'side-by-side', overlayOpacity: 0.5, overlayHeatmap: false },
  pages: { allRuns: false },
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): void {
  listeners.add(listener);
}

/** Mutate state via the updater, then re-render every subscriber. */
export function update(updater: (state: AppState) => void): void {
  updater(state);
  for (const listener of listeners) listener();
}
