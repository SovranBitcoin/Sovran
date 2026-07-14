import { requestClear, requestTrigger, selectVersion } from '../actions';
import { state, update } from '../state';

export function renderTopbar(root: HTMLElement): void {
  const entry = state.catalog.find((candidate) => candidate.id === state.selectedScenarioId);
  const versions = (entry?.runs ?? []).filter((run) => run.proof === 'product-run');
  const busy = state.job?.status === 'running';

  const versionOptions = versions
    .map(
      (run) =>
        `<option value="${run.runId}"${state.selectedRunId === run.runId ? ' selected' : ''}>` +
        `${run.label}${run.ok === false ? ' ✗' : run.ok ? ' ✓' : ''}</option>`
    )
    .join('');

  root.innerHTML =
    `<button data-action="mode-browse" class="${state.mode === 'browse' ? 'primary' : ''}">Browse</button>` +
    `<button data-action="mode-diff" class="${state.mode === 'diff' ? 'primary' : ''}">Diff</button>` +
    `<button data-action="mode-pages" class="${state.mode === 'pages' ? 'primary' : ''}">Pages</button>` +
    (state.mode === 'browse' && versions.length > 0
      ? `<select data-action="version" aria-label="run version" title="run version">${versionOptions}</select>`
      : '') +
    `<span class="spacer"></span>` +
    (state.error ? `<span class="status-pill glyph-fail">${state.error}</span>` : '') +
    (busy ? `<span class="status-pill">job running…</span>` : '') +
    `<button data-action="rerun" ${busy || !state.selectedScenarioId ? 'disabled' : ''}>${versions.length > 0 ? 'Rerun scenario' : 'Run scenario'}</button>` +
    `<button data-action="suite-default" ${busy ? 'disabled' : ''}>Run default suite</button>` +
    `<button data-action="suite-full" ${busy ? 'disabled' : ''}>Run full suite</button>` +
    `<button data-action="commit-run" ${busy ? 'disabled' : ''} title="requires a clean git tree">Commit run</button>` +
    `<button data-action="clear" class="danger" ${busy ? 'disabled' : ''}>Clear</button>`;

  root.querySelector('[data-action=mode-browse]')?.addEventListener('click', () =>
    update((current) => {
      current.mode = 'browse';
    })
  );
  root.querySelector('[data-action=mode-diff]')?.addEventListener('click', () =>
    update((current) => {
      current.mode = 'diff';
      current.playing = false;
    })
  );
  root.querySelector('[data-action=mode-pages]')?.addEventListener('click', () =>
    update((current) => {
      current.mode = 'pages';
      current.playing = false;
    })
  );
  root
    .querySelector<HTMLSelectElement>('[data-action=version]')
    ?.addEventListener('change', (event) =>
      selectVersion((event.target as HTMLSelectElement).value)
    );
  root.querySelector('[data-action=rerun]')?.addEventListener('click', () => {
    if (state.selectedScenarioId)
      requestTrigger(
        { kind: 'scenario', scenarioId: state.selectedScenarioId },
        `Rerun ${state.selectedScenarioId}`
      );
  });
  root
    .querySelector('[data-action=suite-default]')
    ?.addEventListener('click', () =>
      requestTrigger({ kind: 'suite', suite: 'default' }, 'Run default suite')
    );
  root
    .querySelector('[data-action=suite-full]')
    ?.addEventListener('click', () =>
      requestTrigger({ kind: 'suite', suite: 'full' }, 'Run full suite')
    );
  root
    .querySelector('[data-action=commit-run]')
    ?.addEventListener('click', () =>
      requestTrigger({ kind: 'commit-run', suite: 'full' }, 'Commit run (full suite)')
    );
  root.querySelector('[data-action=clear]')?.addEventListener('click', requestClear);
}
