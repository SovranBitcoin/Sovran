import { computeDiff } from '../actions';
import { api } from '../api';
import { state, update } from '../state';
import { attachDeviceCorners } from './deviceCorners';
import type { DiffPairResult, DiffResult } from '../../lib/types';

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

/** Matches the server's RELEVANT ranking set, so the scenario badge always
 * corresponds to a visible row. */
const VISIBLE_PHASES: ReadonlySet<string> = new Set(['T', 'V', 'FINAL', 'named']);

/** The selected scenario's pairs in reel order (run A's artifactSeq; pairs
 * from pre-v2 caches or B-only steps fall back to key order at the end). */
function visiblePairs(result: DiffResult, scenarioId: string): DiffPairResult[] {
  return result.pairs
    .filter(
      (pair) =>
        pair.scenarioId === scenarioId && (state.showAllPhases || VISIBLE_PHASES.has(pair.phase))
    )
    .sort(
      (x, y) =>
        (x.order ?? Number.MAX_SAFE_INTEGER) - (y.order ?? Number.MAX_SAFE_INTEGER) ||
        x.key.localeCompare(y.key)
    );
}

function currentPairs(): DiffPairResult[] {
  const { result, selectedScenarioId } = state.diff;
  if (!result || !selectedScenarioId) return [];
  return visiblePairs(result, selectedScenarioId);
}

/** ←/→ in diff mode: slide through the scenario's pairs. */
export function diffTransportStep(delta: 1 | -1): void {
  const total = currentPairs().length;
  if (!total) return;
  update((current) => {
    current.diff.pairIndex = Math.min(total - 1, Math.max(0, current.diff.pairIndex + delta));
  });
}

function pairLabel(pair: DiffPairResult): string {
  if (pair.phase === 'named') return `◈ ${pair.name ?? ''}`;
  return [pair.stepId, pair.kind, pair.label].filter(Boolean).join(' · ');
}

function statusGlyph(pair: DiffPairResult): { glyph: string; cls: string } {
  switch (pair.status) {
    case 'identical':
      return { glyph: '·', cls: 'none' };
    case 'diff':
      return { glyph: '✗', cls: (pair.diffPct ?? 0) > 0.02 ? 'fail' : 'warn' };
    case 'added':
      return { glyph: '+', cls: 'named' };
    case 'removed':
      return { glyph: '−', cls: 'fail' };
    default:
      return { glyph: '⚠', cls: 'warn' };
  }
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

function runLabelOf(runId: string): string {
  const run = state.runs.find((candidate) => `run-${candidate.runId}` === runId);
  return run?.label ?? runId;
}

function deviceTypeOf(runId: string): string | undefined {
  return state.runs.find((candidate) => `run-${candidate.runId}` === runId)?.deviceType;
}

/** One steps-pane row per pair: gutter, status glyph, tokenized label, pct. */
function renderPairRow(pair: DiffPairResult, index: number): string {
  const { glyph, cls } = statusGlyph(pair);
  const hot = pair.status === 'diff' && (pair.diffPct ?? 0) > 0.02;
  const rowClass = `step-item diff-row${hot ? ' fail' : ''}${pair.phase === 'named' ? ' named' : ''}`;
  const code =
    pair.phase === 'named'
      ? `<span class="tok-name">${escapeHtml(pair.name ?? '')}</span>`
      : `<span class="tok-id">${escapeHtml(pair.stepId ?? '')}</span>` +
        (pair.kind ? `<span class="tok-kind">${escapeHtml(pair.kind)}</span>` : '') +
        (pair.label ? `<span class="tok-label">${escapeHtml(pair.label)}</span>` : '');
  const badge =
    pair.status === 'diff' || pair.status === 'dimension-mismatch'
      ? pctBadge(pair.diffPct ?? 1)
      : pair.status === 'identical'
        ? ''
        : `<span class="pct-zero">${pair.status}</span>`;
  return (
    `<div class="${rowClass}" data-index="${index}">` +
    `<span class="step-gutter">${index + 1}</span>` +
    `<span class="step-status ${cls}">${glyph}</span>` +
    `<span class="step-code">${code}</span>` +
    `<span class="step-pct">${badge}</span>` +
    `</div>`
  );
}

function scrubCellClass(pair: DiffPairResult): string {
  if (pair.status === 'identical') return '';
  if (pair.status === 'diff') return (pair.diffPct ?? 0) > 0.02 ? ' hot' : ' warm';
  if (pair.status === 'added' || pair.status === 'removed') return ' edge';
  return ' hot';
}

export function renderDiffView(root: HTMLElement): void {
  const { runA, runB, result, computing, view, selectedScenarioId } = state.diff;
  const pairs = currentPairs();
  const sig = [
    result?.runA ?? '',
    result?.runB ?? '',
    result?.computedAt ?? '',
    selectedScenarioId ?? '',
    state.showAllPhases,
    view,
    pairs.length,
    runA ?? '',
    runB ?? '',
    computing ? JSON.stringify(computing) : '',
  ].join('|');
  if (root.dataset.diffSig !== sig) {
    buildShell(root, pairs);
    root.dataset.diffSig = sig;
  }
  patchDynamic(root, pairs);
}

function buildShell(root: HTMLElement, pairs: DiffPairResult[]): void {
  const { runA, runB, result, computing, view, selectedScenarioId } = state.diff;
  const progress =
    computing && computing !== 'starting'
      ? ` computing ${computing.done}/${computing.total}…`
      : computing
        ? ' starting…'
        : '';

  const pickers = `<div class="pickers">
      <span>A</span><select data-action="run-a">${runOptions(runA)}</select>
      <span>B</span><select data-action="run-b">${runOptions(runB)}</select>
      <button data-action="compute" class="primary" ${!runA || !runB || runA === runB || computing ? 'disabled' : ''}>Diff</button>
      <span class="status-pill">${progress}</span>
    </div>`;

  if (!result) {
    // "player" scope reuses the browse layout CSS wholesale; "diff" adds the
    // diff-specific rules on top.
    root.innerHTML = `<div class="player diff">${pickers}
      <div class="stage-row"><div class="stage-col"><div class="stage"><span class="empty">${
        computing
          ? 'computing…'
          : 'pick two completed runs above — the Diff tab defaults to the selected run vs the previous one when both exist'
      }</span></div></div></div></div>`;
    wirePickers(root);
    return;
  }

  const scenario = result.scenarios.find((entry) => entry.scenarioId === selectedScenarioId);
  const scenarioBadge = scenario
    ? pctBadge(state.showAllPhases ? scenario.maxDiffPct : scenario.maxDiffPctRelevant)
    : '';

  const scenarioRows = result.scenarios
    .map((entry) => {
      const selected = entry.scenarioId === selectedScenarioId;
      const plus = entry.added ? ` +${entry.added}` : '';
      const minus = entry.removed ? ` −${entry.removed}` : '';
      return (
        `<div class="diff-scn${selected ? ' current' : ''}" data-scenario="${escapeHtml(entry.scenarioId)}">` +
        `<span class="diff-scn-name">${escapeHtml(entry.name)}</span>` +
        `<span class="diff-scn-counts">${entry.changed}/${entry.changed + entry.identical}${plus}${minus}</span>` +
        `${pctBadge(state.showAllPhases ? entry.maxDiffPct : entry.maxDiffPctRelevant)}` +
        `</div>`
      );
    })
    .join('');

  const stepRows = pairs.map((pair, index) => renderPairRow(pair, index)).join('');

  const cells = pairs
    .map(
      (pair, index) => `<div class="scrub-cell${scrubCellClass(pair)}" data-cell="${index}"></div>`
    )
    .join('');

  const viewToggle =
    `<div class="view-toggle-row"><div class="view-toggle" role="tablist" aria-label="diff view">` +
    `<button role="tab" aria-selected="${view === 'side-by-side'}" class="seg${view === 'side-by-side' ? ' active' : ''}" data-action="view-split">Side by side</button>` +
    `<button role="tab" aria-selected="${view === 'heatmap'}" class="seg${view === 'heatmap' ? ' active' : ''}" data-action="view-heatmap">Heatmap</button>` +
    `</div></div>`;

  const metaRows =
    `<span class="k">A</span><span class="v">${escapeHtml(runLabelOf(result.runA))}</span>` +
    `<span class="k">B</span><span class="v">${escapeHtml(runLabelOf(result.runB))}</span>` +
    `<span class="k">pairs</span><span class="v">${pairs.length}</span>`;

  // Constant stage structure across pairs: patchDynamic only flips src /
  // hidden, so scrubbing never rebuilds <img> nodes (or their corner observers).
  const stageMedia =
    state.diff.view === 'heatmap'
      ? `<img data-side="heat" alt="diff heatmap" class="hidden" />
         <span class="stage-missing hidden" data-missing="heat"></span>`
      : `<div class="stage-half">
           <img data-side="a" alt="run A" class="hidden" />
           <span class="stage-missing hidden" data-missing="a">not in A</span>
         </div>
         <div class="stage-half">
           <img data-side="b" alt="run B" class="hidden" />
           <span class="stage-missing hidden" data-missing="b">not in B</span>
         </div>`;

  root.innerHTML = `<div class="player diff">
    ${pickers}
    <div class="stage-row">
      <div class="stage-col">
        <div class="stage split">${stageMedia}<div class="caption" data-role="caption"></div></div>
        <div class="controls">
          <div class="scrubber">
            <div class="scrub-track">
              <div class="scrub-cells" data-role="cells">${cells}</div>
              <input type="range" data-action="scrub" aria-label="pair" min="0" max="${Math.max(0, pairs.length - 1)}" step="1" value="0" ${pairs.length < 2 ? 'disabled' : ''}/>
            </div>
          </div>
          <span class="counter" data-role="counter"></span>
        </div>
      </div>
      <div class="side">
        <div class="titles">
          <h1>${escapeHtml(scenario?.name ?? '')} ${scenarioBadge}</h1>
        </div>
        ${viewToggle}
        <div class="scenario-meta">${metaRows}</div>
        <div class="diff-scenarios">${scenarioRows}</div>
        <div class="steps-pane">
          <div class="steps-head">
            <span class="steps-title">Steps</span>
            <span class="steps-count">${pairs.length}</span>
            <label class="check"><input type="checkbox" data-action="phases" ${state.showAllPhases ? 'checked' : ''}/> setup / cleanup</label>
          </div>
          <div class="step-list">${stepRows}</div>
        </div>
      </div>
    </div>
  </div>`;

  wirePickers(root);

  root.querySelector('[data-action=view-split]')?.addEventListener('click', () =>
    update((current) => {
      current.diff.view = 'side-by-side';
    })
  );
  root.querySelector('[data-action=view-heatmap]')?.addEventListener('click', () =>
    update((current) => {
      current.diff.view = 'heatmap';
    })
  );
  root.querySelector<HTMLInputElement>('[data-action=phases]')?.addEventListener('change', () =>
    update((current) => {
      current.showAllPhases = !current.showAllPhases;
      current.diff.pairIndex = 0;
    })
  );
  for (const row of root.querySelectorAll<HTMLElement>('.diff-scn')) {
    row.addEventListener('click', () =>
      update((current) => {
        current.diff.selectedScenarioId = row.dataset.scenario;
        current.diff.pairIndex = 0;
      })
    );
  }
  for (const item of root.querySelectorAll<HTMLElement>('.step-item')) {
    item.addEventListener('click', () =>
      update((current) => {
        current.diff.pairIndex = Number(item.dataset.index);
      })
    );
  }
  root.querySelector<HTMLInputElement>('[data-action=scrub]')?.addEventListener('input', (event) =>
    update((current) => {
      current.diff.pairIndex = Number((event.target as HTMLInputElement).value);
    })
  );

  const imgA = root.querySelector<HTMLElement>('img[data-side=a]');
  const imgB = root.querySelector<HTMLElement>('img[data-side=b]');
  const imgHeat = root.querySelector<HTMLElement>('img[data-side=heat]');
  if (imgA) attachDeviceCorners(imgA, deviceTypeOf(result.runA));
  if (imgB) attachDeviceCorners(imgB, deviceTypeOf(result.runB));
  if (imgHeat) attachDeviceCorners(imgHeat, deviceTypeOf(result.runB));
}

function wirePickers(root: HTMLElement): void {
  // manual picks detach the pair from the left-panel selection: forRun is
  // cleared so re-entering the tab doesn't auto-retarget over them
  root
    .querySelector<HTMLSelectElement>('[data-action=run-a]')
    ?.addEventListener('change', (event) =>
      update((current) => {
        current.diff.runA = (event.target as HTMLSelectElement).value || undefined;
        current.diff.forRun = undefined;
      })
    );
  root
    .querySelector<HTMLSelectElement>('[data-action=run-b]')
    ?.addEventListener('change', (event) =>
      update((current) => {
        current.diff.runB = (event.target as HTMLSelectElement).value || undefined;
        current.diff.forRun = undefined;
      })
    );
  root.querySelector('[data-action=compute]')?.addEventListener('click', () => void computeDiff());
}

/** Everything the scrubber touches: srcs, placeholders, caption, slider,
 * counter, current-row/cell highlights. No innerHTML — drags stay smooth. */
function patchDynamic(root: HTMLElement, pairs: DiffPairResult[]): void {
  const result = state.diff.result;
  if (!result || !pairs.length) return;
  const index = Math.min(state.diff.pairIndex, pairs.length - 1);
  const pair = pairs[index];
  const key = diffKey(result.runA, result.runB);

  const setSide = (side: 'a' | 'b' | 'heat', url: string | undefined, missingText?: string) => {
    const img = root.querySelector<HTMLImageElement>(`img[data-side=${side}]`);
    const missing = root.querySelector<HTMLElement>(`[data-missing=${side}]`);
    if (!img || !missing) return;
    img.classList.toggle('hidden', !url);
    missing.classList.toggle('hidden', !!url);
    if (url && !img.src.endsWith(url)) img.src = url;
    if (!url && missingText) missing.textContent = missingText;
  };

  if (state.diff.view === 'heatmap') {
    const heatUrl = pair.diffFile ? api.diffImageUrl(key, pair.diffFile) : undefined;
    setSide(
      'heat',
      heatUrl,
      pair.status === 'identical' ? 'identical — no changed pixels' : `no heatmap (${pair.status})`
    );
  } else {
    setSide('a', pair.aFile ? api.runFileUrl(result.runA, pair.aFile) : undefined);
    setSide('b', pair.bFile ? api.runFileUrl(result.runB, pair.bFile) : undefined);
  }

  const captionEl = root.querySelector<HTMLElement>('[data-role=caption]');
  if (captionEl) {
    const badge =
      pair.status === 'diff' || pair.status === 'dimension-mismatch'
        ? ` ${pctBadge(pair.diffPct ?? 1)}`
        : pair.status === 'identical'
          ? ' <span class="pct-zero">identical</span>'
          : ` <span class="pct-zero">${pair.status}</span>`;
    captionEl.innerHTML = `${escapeHtml(pairLabel(pair))}${badge}`;
    captionEl.classList.toggle('fail', pair.status === 'diff' && (pair.diffPct ?? 0) > 0.02);
  }

  const scrub = root.querySelector<HTMLInputElement>('[data-action=scrub]');
  if (scrub && Number(scrub.value) !== index) scrub.value = String(index);
  scrub?.setAttribute('aria-valuetext', pairLabel(pair));

  const counter = root.querySelector<HTMLElement>('[data-role=counter]');
  if (counter) counter.textContent = `${index + 1}/${pairs.length}`;

  root.querySelectorAll<HTMLElement>('.scrub-cell').forEach((cell, cellIndex) => {
    cell.classList.toggle('current', cellIndex === index);
  });
  root.querySelectorAll<HTMLElement>('.step-item').forEach((item, itemIndex) => {
    item.classList.toggle('current', itemIndex === index);
    if (itemIndex === index) item.scrollIntoView({ block: 'nearest' });
  });

  // keep neighbours warm so scrubbing feels instant
  for (const neighbour of [pairs[index - 1], pairs[index + 1]]) {
    if (!neighbour) continue;
    if (state.diff.view === 'heatmap') {
      if (neighbour.diffFile) new Image().src = api.diffImageUrl(key, neighbour.diffFile);
    } else {
      if (neighbour.aFile) new Image().src = api.runFileUrl(result.runA, neighbour.aFile);
      if (neighbour.bFile) new Image().src = api.runFileUrl(result.runB, neighbour.bFile);
    }
  }
}
