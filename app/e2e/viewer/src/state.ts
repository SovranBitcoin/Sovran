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
  runIds: string[];
  lines: string[];
  status: 'running' | 'exited';
  exitCode?: number;
  /** First kill click arms the button; the second one actually kills. */
  killArmed?: boolean;
}

type ModalView =
  | {
      kind: 'trigger';
      title: string;
      argvs: string[][];
      funded: boolean;
      send: (acceptFundLoss: boolean) => void;
    }
  | { kind: 'clear'; skipped: string[]; send: () => void };

export interface AppState {
  mode: 'browse' | 'diff' | 'pages' | 'store';
  runs: RunSummary[];
  catalog: ScenarioCatalogEntry[];
  selectedRunId?: string;
  selectedScenarioId?: string;
  runDetail?: RunDetail;
  frameIndex: number;
  /** Slideshow auto-advance — screenshots mode only. In video mode the
   * <video> element owns play state and this stays false. */
  playing: boolean;
  showAllPhases: boolean;
  /** Play the scenario's test+verify screen recording instead of the frame reel. */
  videoMode: boolean;
  /** Active tab of the side panel: the step list, or the per-frame app-state
   * view (zustand snapshot + coco db dump). */
  sideTab: 'steps' | 'state';
  diff: {
    runA?: string;
    runB?: string;
    /** The left-panel run the pair was derived FOR (undefined after manual
     * picker use) — re-entering the tab only re-targets when the selection
     * moved away from this. */
    forRun?: string;
    result?: DiffResult;
    computing?: { done: number; total: number } | 'starting';
    selectedScenarioId?: string;
    /** Index into the selected scenario's phase-filtered, reel-ordered pairs. */
    pairIndex: number;
    view: 'side-by-side' | 'heatmap';
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
  /** Follow the live run: auto-open each scenario as it begins. Set when a run
   * job starts (or a live run is adopted at boot); cleared by any user click. */
  followLive?: boolean;
  /** Collapsed flow-facet groups in the scenario tree; survives reloads. */
  collapsedFlows: string[];
}

const COLLAPSED_KEY = 'e2e-viewer-collapsed-flows';

function loadCollapsedFlows(): string[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((flow) => typeof flow === 'string') : [];
  } catch {
    return [];
  }
}

export function persistCollapsedFlows(): void {
  try {
    sessionStorage.setItem(COLLAPSED_KEY, JSON.stringify(state.collapsedFlows));
  } catch {
    // storage full/blocked — collapse state just won't survive the reload
  }
}

export const state: AppState = {
  mode: 'browse',
  runs: [],
  catalog: [],
  frameIndex: 0,
  playing: false,
  showAllPhases: false,
  videoMode: false,
  sideTab: 'steps',
  diff: { view: 'side-by-side', pairIndex: 0 },
  pages: { allRuns: false },
  collapsedFlows: loadCollapsedFlows(),
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
