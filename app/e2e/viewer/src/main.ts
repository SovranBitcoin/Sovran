import { refreshAll, selectScenario } from './actions';
import { renderDiffView } from './components/diffView';
import { renderModal } from './components/modal';
import { renderPagesView } from './components/pagesView';
import { currentTimeline, renderPlayer, visibleFrames } from './components/player';
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
  if (state.mode === 'browse') renderPlayer(contentEl);
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
  const frames = visibleFrames(timeline);
  update((current) => {
    if (current.frameIndex < frames.length - 1) current.frameIndex++;
    else current.playing = false;
  });
}, 600);

document.addEventListener('keydown', (event) => {
  if (state.modal || state.mode !== 'browse') return;
  const target = event.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
  const timeline = currentTimeline();
  if (!timeline) return;
  const frames = visibleFrames(timeline);
  if (event.key === 'ArrowRight') {
    update((current) => {
      current.playing = false;
      current.frameIndex = Math.min(frames.length - 1, current.frameIndex + 1);
    });
  } else if (event.key === 'ArrowLeft') {
    update((current) => {
      current.playing = false;
      current.frameIndex = Math.max(0, current.frameIndex - 1);
    });
  } else if (event.key === ' ') {
    event.preventDefault();
    update((current) => {
      if (!current.playing && current.frameIndex >= frames.length - 1) current.frameIndex = 0;
      current.playing = !current.playing;
    });
  }
});

void refreshAll().then(() => {
  const first = state.runs.find((run) => run.proof === 'product-run' && run.scenarioIds.length > 0);
  if (first) void selectScenario(`run-${first.runId}`, first.scenarioIds[0]);
});
