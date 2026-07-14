import { computeDiff } from '../actions';
import { api } from '../api';
import { state, update } from '../state';
import type { DiffPairResult } from '../../lib/types';

/** Must mirror diffKey in lib/diff.ts (not imported: that module is server-only). */
function diffKey(runA: string, runB: string): string {
  return `${runA}__${runB}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pctBadge(pct: number): string {
  const text = `${(pct * 100).toFixed(2)}%`;
  const cls = pct === 0 ? 'pct-zero' : pct > 0.02 ? 'pct-hot' : 'pct-warm';
  return `<span class="${cls}">${text}</span>`;
}

function pairLabel(pair: DiffPairResult): string {
  return pair.phase === 'named' ? `named:${pair.name}` : `${pair.stepId}`;
}

function runOptions(selected?: string): string {
  return (
    '<option value="">— pick a run —</option>' +
    state.runs
      .filter((run) => run.proof === 'product-run' && run.status === 'complete')
      .map((run) => {
        const id = `run-${run.runId}`;
        return `<option value="${id}"${selected === id ? ' selected' : ''}>${escapeHtml(run.label)} · ${escapeHtml(run.suite)}</option>`;
      })
      .join('')
  );
}

export function renderDiffView(root: HTMLElement): void {
  const { runA, runB, result, computing, view } = state.diff;
  const progress =
    computing && computing !== 'starting'
      ? ` computing ${computing.done}/${computing.total}…`
      : computing
        ? ' starting…'
        : '';

  const parts: string[] = [
    `<div class="diff">
      <div class="pickers">
        <span>A</span><select data-action="run-a">${runOptions(runA)}</select>
        <span>B</span><select data-action="run-b">${runOptions(runB)}</select>
        <button data-action="compute" class="primary" ${!runA || !runB || runA === runB || computing ? 'disabled' : ''}>Diff</button>
        <span class="status-pill">${progress}</span>
      </div>`,
  ];

  if (result) {
    parts.push(`<table><tr><th>scenario</th><th>max diff</th><th>changed</th><th>±</th></tr>`);
    for (const scenario of result.scenarios) {
      const selected = state.diff.selectedScenarioId === scenario.scenarioId;
      parts.push(
        `<tr class="clickable${selected ? ' selected' : ''}" data-scenario="${escapeHtml(scenario.scenarioId)}">` +
          `<td>${escapeHtml(scenario.name)}</td>` +
          `<td>${pctBadge(state.showAllPhases ? scenario.maxDiffPct : scenario.maxDiffPctRelevant)}</td>` +
          `<td>${scenario.changed}/${scenario.changed + scenario.identical}</td>` +
          `<td>${scenario.added ? `+${scenario.added}` : ''}${scenario.removed ? ` −${scenario.removed}` : ''}</td></tr>`
      );
    }
    parts.push('</table>');

    if (state.diff.selectedScenarioId) {
      const pairs = result.pairs.filter(
        (pair) =>
          pair.scenarioId === state.diff.selectedScenarioId &&
          (state.showAllPhases ||
            pair.phase === 'T' ||
            pair.phase === 'V' ||
            pair.phase === 'named')
      );
      parts.push(`<table><tr><th>step</th><th>status</th><th>diff</th></tr>`);
      for (const pair of pairs) {
        const selected = state.diff.selectedPairKey === pair.key;
        parts.push(
          `<tr class="clickable${selected ? ' selected' : ''}" data-pair="${escapeHtml(pair.key)}">` +
            `<td>${escapeHtml(pairLabel(pair))}</td><td>${pair.status}</td>` +
            `<td>${pair.diffPct !== undefined ? pctBadge(pair.diffPct) : ''}</td></tr>`
        );
      }
      parts.push('</table>');

      const pair = result.pairs.find((candidate) => candidate.key === state.diff.selectedPairKey);
      if (pair) parts.push(renderPair(pair, result.runA, result.runB, view));
    }
  }
  parts.push('</div>');
  root.innerHTML = parts.join('');

  root
    .querySelector<HTMLSelectElement>('[data-action=run-a]')
    ?.addEventListener('change', (event) =>
      update((current) => {
        current.diff.runA = (event.target as HTMLSelectElement).value || undefined;
      })
    );
  root
    .querySelector<HTMLSelectElement>('[data-action=run-b]')
    ?.addEventListener('change', (event) =>
      update((current) => {
        current.diff.runB = (event.target as HTMLSelectElement).value || undefined;
      })
    );
  root.querySelector('[data-action=compute]')?.addEventListener('click', () => void computeDiff());
  for (const row of root.querySelectorAll<HTMLElement>('tr[data-scenario]')) {
    row.addEventListener('click', () =>
      update((current) => {
        current.diff.selectedScenarioId = row.dataset.scenario;
        current.diff.selectedPairKey = undefined;
      })
    );
  }
  for (const row of root.querySelectorAll<HTMLElement>('tr[data-pair]')) {
    row.addEventListener('click', () =>
      update((current) => {
        current.diff.selectedPairKey = row.dataset.pair;
      })
    );
  }
  root.querySelector('[data-action=view-toggle]')?.addEventListener('click', () =>
    update((current) => {
      current.diff.view = current.diff.view === 'side-by-side' ? 'overlay' : 'side-by-side';
    })
  );
  // opacity drags patch the image directly — a re-render mid-drag would
  // replace the slider under the cursor
  root
    .querySelector<HTMLInputElement>('[data-action=overlay-opacity]')
    ?.addEventListener('input', (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      state.diff.overlayOpacity = value;
      const overlay = root.querySelector<HTMLImageElement>('.overlay-stage img[alt=B]');
      if (overlay) overlay.style.opacity = String(value);
    });
  root
    .querySelector<HTMLInputElement>('[data-action=overlay-heatmap]')
    ?.addEventListener('change', () =>
      update((current) => {
        current.diff.overlayHeatmap = !current.diff.overlayHeatmap;
      })
    );
}

function renderPair(
  pair: DiffPairResult,
  runA: string,
  runB: string,
  view: 'side-by-side' | 'overlay'
): string {
  const key = diffKey(runA, runB);
  const aImg = pair.aFile ? api.runFileUrl(runA, pair.aFile) : undefined;
  const bImg = pair.bFile ? api.runFileUrl(runB, pair.bFile) : undefined;
  const heat = pair.diffFile ? api.diffImageUrl(key, pair.diffFile) : undefined;

  const toggle = `<div class="pickers">
    <button data-action="view-toggle">${view === 'side-by-side' ? 'overlay view' : 'side-by-side view'}</button>
    ${
      view === 'overlay'
        ? `<label class="check">B opacity <input type="range" data-action="overlay-opacity" min="0" max="1" step="0.05" value="${state.diff.overlayOpacity}"/></label>
           ${heat ? `<label class="check"><input type="checkbox" data-action="overlay-heatmap" ${state.diff.overlayHeatmap ? 'checked' : ''}/> heatmap</label>` : ''}`
        : ''
    }
  </div>`;

  if (view === 'overlay' && aImg && bImg) {
    return `<div class="pair-viewer">${toggle}
      <div class="overlay-stage">
        <img src="${aImg}" alt="A"/>
        <img src="${bImg}" alt="B" style="opacity:${state.diff.overlayOpacity}"/>
        ${state.diff.overlayHeatmap && heat ? `<img src="${heat}" alt="diff"/>` : ''}
      </div></div>`;
  }
  return `<div class="pair-viewer">${toggle}
    <div class="pair-images">
      ${aImg ? `<figure><img src="${aImg}" alt="A"/><figcaption>A</figcaption></figure>` : ''}
      ${bImg ? `<figure><img src="${bImg}" alt="B"/><figcaption>B</figcaption></figure>` : ''}
      ${heat ? `<figure><img src="${heat}" alt="diff"/><figcaption>diff</figcaption></figure>` : ''}
    </div></div>`;
}
