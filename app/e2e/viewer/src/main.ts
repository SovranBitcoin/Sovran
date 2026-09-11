import { renderStoreView } from './components/storeView';
import { refreshAll, selectScenario, startLivePoll } from './actions';
import { diffTransportStep, renderDiffView } from './components/diffView';
import { renderModal } from './components/modal';
import { renderPagesView } from './components/pagesView';
import {
  currentTimeline,
  renderPlayer,
  transportStep,
  transportTogglePlay,
  visibleFrames,
} from './components/player';
import { renderConsole } from './components/runConsole';
import { renderRunList } from './components/runList';
import { renderTopbar } from './components/topbar';
import { state, subscribe, update } from './state';

const runsEl = document.getElementById('runs')!;
const topbarEl = document.getElementById('topbar')!;
const contentEl = document.getElementById('content')!;
const consoleEl = document.getElementById('console')!;
const modalEl = document.getElementById('modal-root')!;

function render(): void {
  renderRunList(runsEl);
  renderTopbar(topbarEl);
  // Mode switches must drop the views' shell signatures: #content still holds
  // the previous mode's DOM, and a matching stale sig would skip the rebuild —
  // leaving e.g. the browse player on screen with the Diff tab active.
  if (contentEl.dataset.mode !== state.mode) {
    delete contentEl.dataset.playerSig;
    delete contentEl.dataset.diffSig;
    contentEl.dataset.mode = state.mode;
  }
  if (state.mode === 'browse') renderPlayer(contentEl);
  else if (state.mode === 'store') renderStoreView(contentEl);
  else if (state.mode === 'pages') renderPagesView(contentEl);
  else renderDiffView(contentEl);
  renderConsole(consoleEl);
  renderModal(modalEl);
}

subscribe(render);

// slideshow: advance until the last (FINAL/wallet) frame, then stop
setInterval(() => {
  if (!state.playing) return;
  const timeline = currentTimeline();
  if (!timeline) return;
  // video mode never sets playing, but belt-and-braces: the <video> owns time
  if (state.videoMode && timeline.videoFile) return;
  const frames = visibleFrames(timeline);
  update((current) => {
    if (current.frameIndex < frames.length - 1) current.frameIndex++;
    else current.playing = false;
  });
}, 600);

document.addEventListener('keydown', (event) => {
  if (state.modal) return;
  const target = event.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
  if (state.mode === 'diff') {
    if (event.key === 'ArrowRight') diffTransportStep(1);
    else if (event.key === 'ArrowLeft') diffTransportStep(-1);
    return;
  }
  if (state.mode !== 'browse' || !currentTimeline()) return;
  if (event.key === 'ArrowRight') transportStep(1);
  else if (event.key === 'ArrowLeft') transportStep(-1);
  else if (event.key === ' ') {
    event.preventDefault();
    transportTogglePlay();
  }
});

void refreshAll().then(() => {
  // Opening the viewer mid-run (e.g. a terminal-started suite) lands on the
  // live run's active scenario and follows it; otherwise the newest product run.
  const live = state.runs.find(
    (run) => run.proof === 'product-run' && run.status === 'in-progress'
  );
  if (live) {
    update((current) => {
      current.followLive = true;
    });
    startLivePoll();
    const scenario = live.activeScenarioId ?? live.scenarioIds[0];
    if (scenario) void selectScenario(`run-${live.runId}`, scenario, 'auto');
    return;
  }
  const first = state.runs.find((run) => run.proof === 'product-run' && run.scenarioIds.length > 0);
  if (first) void selectScenario(`run-${first.runId}`, first.scenarioIds[0], 'auto');
});
