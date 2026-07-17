import { enterDiffMode, requestClear, requestTrigger, selectVersion } from '../actions';
import { state, update } from '../state';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Two-deck header: brand + action cluster share the top row (actions get the
 * full width, so the cluster never wraps), underline-style mode tabs sit on
 * the header's bottom border like a GitHub repo nav. */
export function renderTopbar(root: HTMLElement): void {
  const entry = state.catalog.find((candidate) => candidate.id === state.selectedScenarioId);
  const versions = (entry?.runs ?? []).filter((run) => run.proof === 'product-run');
  const busy = state.job?.status === 'running';
  const git = state.runDetail?.git;

  const versionOptions = versions
    .map(
      (run) =>
        `<option value="${run.runId}"${state.selectedRunId === run.runId ? ' selected' : ''}>` +
        `${run.label}${run.ok === false ? ' ✗' : run.ok ? ' ✓' : ''}</option>`
    )
    .join('');

  const tab = (mode: typeof state.mode, label: string) =>
    `<button role="tab" aria-selected="${state.mode === mode}" data-action="mode-${mode}" ` +
    `class="tab${state.mode === mode ? ' active' : ''}">${label}</button>`;

  root.innerHTML =
    `<div class="topbar-row">` +
    `<div class="brand">` +
    `<span class="brand-mark">e2e</span>` +
    `<span class="brand-name">run viewer</span>` +
    (git
      ? `<span class="brand-context" title="${escapeHtml(git.sha)}">${escapeHtml(git.branch)}${git.dirty ? '*' : ''} · ${escapeHtml(git.shortSha)}</span>`
      : '') +
    `</div>` +
    `<div class="topbar-actions">` +
    (state.error ? `<span class="status-pill glyph-fail">${escapeHtml(state.error)}</span>` : '') +
    (busy ? `<span class="status-pill">job running…</span>` : '') +
    (state.mode === 'browse' && versions.length > 0
      ? `<select data-action="version" aria-label="run version" title="run version">${versionOptions}</select>`
      : '') +
    `<button data-action="rerun" ${busy || !state.selectedScenarioId ? 'disabled' : ''} title="${versions.length > 0 ? 'rerun' : 'run'} the selected scenario">${versions.length > 0 ? 'Rerun' : 'Run scenario'}</button>` +
    `<div class="btn-group" role="group" aria-label="suite runs">` +
    `<span class="btn-group-label">run</span>` +
    `<button data-action="suite-default" ${busy ? 'disabled' : ''} title="run the default suite">Default</button>` +
    `<button data-action="suite-full" ${busy ? 'disabled' : ''} title="run the full suite">Full</button>` +
    `<button data-action="commit-run" ${busy ? 'disabled' : ''} title="commit run: full suite, requires a clean git tree">Commit</button>` +
    `</div>` +
    `<button data-action="clear" class="danger" ${busy ? 'disabled' : ''}>Clear</button>` +
    `</div>` +
    `</div>` +
    `<nav class="mode-tabs" role="tablist" aria-label="viewer mode">` +
    tab('browse', 'Browse') +
    tab('diff', 'Diff') +
    tab('pages', 'Pages') +
    `</nav>`;

  root.querySelector('[data-action=mode-browse]')?.addEventListener('click', () =>
    update((current) => {
      current.mode = 'browse';
    })
  );
  root.querySelector('[data-action=mode-diff]')?.addEventListener('click', enterDiffMode);
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
