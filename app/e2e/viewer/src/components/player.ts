import { api } from '../api';
import { state, update } from '../state';
import type { Frame, ScenarioTimeline } from '../../lib/types';

/** A reel entry: an automatic evidence frame, or a named (canonical-page)
 * capture interleaved at its artifact position. */
export interface ReelFrame extends Frame {
  /** Canonical page name when this entry is a named capture. */
  named?: string;
}

function namedAsFrames(timeline: ScenarioTimeline): ReelFrame[] {
  return timeline.named
    .filter((capture) => capture.artifactSeq !== undefined)
    .map((capture) => ({
      artifactSeq: capture.artifactSeq!,
      stepId: capture.stepId ?? '',
      phase: capture.phase ?? 'T',
      kind: 'screenshot',
      label: capture.occurrence > 1 ? `${capture.name} #${capture.occurrence}` : capture.name,
      file: capture.file,
      axFile: capture.axFile,
      named: capture.name,
    }));
}

/** Setup (P), cleanup (C), and the post-sweep FINAL proof are harness noise by
 * default — the story of a test is T → V, opening and closing on the pages the
 * scenario actually exercises. Named captures interleave at their artifact
 * position so the reel starts on the authored `wallet` shot. */
export function visibleFrames(timeline: ScenarioTimeline): ReelFrame[] {
  const merged: ReelFrame[] = [...timeline.frames, ...namedAsFrames(timeline)].sort(
    (a, b) => a.artifactSeq - b.artifactSeq
  );
  if (state.showAllPhases) return merged;
  return merged.filter((frame) => frame.phase === 'T' || frame.phase === 'V');
}

export function currentTimeline(): ScenarioTimeline | undefined {
  return state.runDetail?.scenarios.find(
    (scenario) => scenario.scenarioId === state.selectedScenarioId
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function caption(frame: ReelFrame): string {
  if (frame.named) {
    return [frame.stepId, `📸 ${frame.label ?? frame.named}`].filter(Boolean).join(' · ');
  }
  const parts = [frame.stepId, frame.kind];
  if (frame.label) parts.push(frame.label);
  if (frame.ok === false) parts.push(`✗ ${frame.error ?? 'failed'}`);
  else if (frame.ok) parts.push('✓');
  return parts.join(' · ');
}

/** The shell (titles, step list, controls) is rebuilt only when the scenario,
 * run, or phase filter changes; frame scrubbing patches src/caption/slider in
 * place so a drag on the range input is never interrupted by a re-render. */
export function renderPlayer(root: HTMLElement): void {
  const timeline = currentTimeline();
  const runId = state.selectedRunId;
  if (!timeline || !runId) {
    delete root.dataset.playerSig;
    const entry = state.catalog.find((candidate) => candidate.id === state.selectedScenarioId);
    if (state.selectedScenarioId && !runId && entry) {
      root.innerHTML = `<div class="player">
        <div class="titles">
          <h1>${escapeHtml(entry.name)}</h1>
          <p>${escapeHtml(entry.description)}</p>
        </div>
        <div class="stage"><span class="empty">no runs yet — use “Run scenario” above</span></div>
      </div>`;
      return;
    }
    root.innerHTML = `<div class="player"><div class="stage"><span class="empty">${
      state.selectedScenarioId ? 'loading…' : 'select a run and scenario on the left'
    }</span></div></div>`;
    return;
  }

  const frames = visibleFrames(timeline);
  const sig = `${runId}|${timeline.scenarioId}|${state.showAllPhases}|${frames.length}`;
  if (root.dataset.playerSig !== sig) {
    buildShell(root, timeline, runId, frames);
    root.dataset.playerSig = sig;
  }
  patchDynamic(root, runId, frames);
}

function buildShell(
  root: HTMLElement,
  timeline: ScenarioTimeline,
  runId: string,
  frames: ReelFrame[]
): void {
  const entry = state.catalog.find((candidate) => candidate.id === timeline.scenarioId);
  const outcome =
    timeline.ok === undefined
      ? ''
      : timeline.ok
        ? ' <span class="glyph-pass">✓ passed</span>'
        : ' <span class="glyph-fail">✗ failed</span>';

  const stepItems = frames
    .map(
      (frame, index) =>
        `<div class="step-item${frame.ok === false ? ' fail' : ''}${frame.named ? ' named' : ''}" data-index="${index}">` +
        `${escapeHtml(caption(frame))}</div>`
    )
    .join('');

  const named = timeline.named
    .map(
      (capture) =>
        `<figure><img loading="lazy" src="${api.runFileUrl(runId, capture.file)}" alt="${escapeHtml(capture.name)}" /><figcaption>${escapeHtml(capture.name)}</figcaption></figure>`
    )
    .join('');

  const facetChips = entry
    ? [
        entry.facets.flow && `flow:${entry.facets.flow}`,
        entry.facets.instrument && `instrument:${entry.facets.instrument}`,
        entry.facets.amount && `amount:${entry.facets.amount}`,
        entry.facets.io && `io:${entry.facets.io}`,
        entry.facets.outcome && `outcome:${entry.facets.outcome}`,
        ...entry.facets.checks.map((check) => `check:${check}`),
        ...entry.facets.extras,
      ]
        .filter((chip): chip is string => !!chip)
        .map(
          (chip) =>
            `<span class="chip${chip.includes(':') ? '' : ' extra'}">${escapeHtml(chip)}</span>`
        )
        .join('')
    : '';

  root.innerHTML = `<div class="player">
    <div class="titles">
      <h1>${escapeHtml(timeline.name)}${outcome}</h1>
      <p>${escapeHtml(entry?.description ?? '')}</p>
      ${facetChips ? `<div class="facet-chips">${facetChips}</div>` : ''}
    </div>
    <div class="stage-row">
      <div class="stage">${
        frames.length
          ? `<img id="stage-img" alt="frame" />`
          : '<span class="empty">no screenshots in this phase filter</span>'
      }</div>
      <div class="side">
        <label class="check"><input type="checkbox" data-action="phases" ${state.showAllPhases ? 'checked' : ''}/> show setup / cleanup</label>
        <div class="step-list">${stepItems}</div>
      </div>
    </div>
    <div class="caption" data-role="caption"></div>
    <div class="controls">
      <button data-action="play" aria-label="play slideshow">▶</button>
      <input type="range" data-action="scrub" aria-label="frame" min="0" max="${Math.max(0, frames.length - 1)}" value="0" ${frames.length < 2 ? 'disabled' : ''}/>
      <span class="counter" data-role="counter"></span>
    </div>
    ${named ? `<div class="named-strip">${named}</div>` : ''}
  </div>`;

  root.querySelector('[data-action=play]')?.addEventListener('click', () =>
    update((current) => {
      const total = visibleFrames(currentTimeline() ?? timeline).length;
      if (!current.playing && current.frameIndex >= total - 1) current.frameIndex = 0;
      current.playing = !current.playing;
    })
  );
  root.querySelector<HTMLInputElement>('[data-action=scrub]')?.addEventListener('input', (event) =>
    update((current) => {
      current.playing = false;
      current.frameIndex = Number((event.target as HTMLInputElement).value);
    })
  );
  root.querySelector<HTMLInputElement>('[data-action=phases]')?.addEventListener('change', () =>
    update((current) => {
      current.showAllPhases = !current.showAllPhases;
      current.frameIndex = 0;
      current.playing = false;
    })
  );
  for (const item of root.querySelectorAll<HTMLElement>('.step-item')) {
    item.addEventListener('click', () =>
      update((current) => {
        current.playing = false;
        current.frameIndex = Number(item.dataset.index);
      })
    );
  }
}

function patchDynamic(root: HTMLElement, runId: string, frames: ReelFrame[]): void {
  const index = Math.min(state.frameIndex, Math.max(0, frames.length - 1));
  const frame = frames[index];

  const img = root.querySelector<HTMLImageElement>('#stage-img');
  if (img && frame) {
    const src = api.runFileUrl(runId, frame.file);
    if (!img.src.endsWith(src)) img.src = src;
  }

  const captionEl = root.querySelector<HTMLElement>('[data-role=caption]');
  if (captionEl) {
    captionEl.textContent = frame ? caption(frame) : '';
    captionEl.classList.toggle('fail', frame?.ok === false);
  }

  const scrub = root.querySelector<HTMLInputElement>('[data-action=scrub]');
  if (scrub && Number(scrub.value) !== index) scrub.value = String(index);

  const counter = root.querySelector<HTMLElement>('[data-role=counter]');
  if (counter) counter.textContent = `${frames.length ? index + 1 : 0}/${frames.length}`;

  const play = root.querySelector<HTMLButtonElement>('[data-action=play]');
  if (play) play.textContent = state.playing ? '⏸' : '▶';

  const items = root.querySelectorAll<HTMLElement>('.step-item');
  items.forEach((item, itemIndex) => {
    item.classList.toggle('current', itemIndex === index);
    if (itemIndex === index) item.scrollIntoView({ block: 'nearest' });
  });

  // keep neighbours warm so scrubbing feels instant
  for (const neighbour of [frames[index - 1], frames[index + 1]]) {
    if (neighbour) new Image().src = api.runFileUrl(runId, neighbour.file);
  }
}
