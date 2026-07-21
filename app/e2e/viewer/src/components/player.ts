import { api } from '../api';
import { facetTagLabel, platformLabels } from '../facetLabels';
import { state, update } from '../state';
import type { AppState } from '../state';
import { attachDeviceCorners } from './deviceCorners';
import { bindStatePane, patchStatePane, renderStateBody } from './statePanel';
import type { Frame, ScenarioTimeline } from '../../lib/types';

/** A reel entry: an automatic evidence frame, or a named (canonical-page)
 * capture interleaved at its artifact position. */
export interface ReelFrame extends Frame {
  /** Canonical page name when this entry is a named capture. */
  named?: string;
}

/* Video transport state lives at module level, outside AppState: the <video>
 * element is the source of truth for time, and routing 4-60Hz timeupdate
 * ticks through update() would re-render every component per tick. Reset on
 * every shell rebuild. */
let videoStartMs: number | undefined;
let scrubbing = false;
/** Per visible-frame index → seconds into the video (undefined = unmappable). */
let frameTimes: (number | undefined)[] = [];
/** Sorted mappable seconds, for prev/next step jumps. */
let tickTimes: number[] = [];
/** Keeps the stage frame's border radius true to hardware across resizes. */
let cornerObserver: ResizeObserver | undefined;

function attachStageCorners(root: HTMLElement): void {
  const el = root.querySelector<HTMLElement>('#stage-img, #stage-video');
  if (!el) return;
  cornerObserver = attachDeviceCorners(el, state.runDetail?.deviceType);
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
      storeFile: capture.storeFile,
      dbFile: capture.dbFile,
      t: capture.t,
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
    return [frame.stepId, `◈ ${frame.label ?? frame.named}`].filter(Boolean).join(' · ');
  }
  const parts = [frame.stepId, frame.kind];
  if (frame.label) parts.push(frame.label);
  if (frame.ok === false) parts.push(`✗ ${frame.error ?? 'failed'}`);
  else if (frame.ok) parts.push('✓');
  return parts.join(' · ');
}

function fmtTime(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function frameTimeSec(frame: ReelFrame, duration: number): number | undefined {
  if (frame.t === undefined || videoStartMs === undefined) return undefined;
  return Math.min(Math.max((frame.t - videoStartMs) / 1000, 0), duration);
}

function nearestFrameIndex(timeSec: number): number | undefined {
  let best: number | undefined;
  let bestDelta = Infinity;
  frameTimes.forEach((sec, index) => {
    if (sec === undefined) return;
    const delta = Math.abs(sec - timeSec);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  return best;
}

function stageVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('#stage-video');
}

function videoIsActive(timeline: ScenarioTimeline | undefined): boolean {
  return !!(state.videoMode && timeline?.videoFile);
}

/** Step one reel frame (screenshots) or jump to the adjacent step marker
 * (video; ±5s when no markers are mappable). Shared by ←/→ everywhere. */
export function transportStep(delta: 1 | -1): void {
  const timeline = currentTimeline();
  if (!timeline) return;
  const video = videoIsActive(timeline) ? stageVideo() : null;
  if (video) {
    // ε keeps a repeated ← moving even when we sit almost exactly on a marker
    const eps = 0.35;
    const now = video.currentTime;
    let target =
      delta > 0
        ? tickTimes.find((sec) => sec > now + eps)
        : [...tickTimes].reverse().find((sec) => sec < now - eps);
    if (target === undefined) {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      target = Math.min(Math.max(now + delta * 5, 0), duration);
    }
    video.currentTime = target;
    return;
  }
  const frames = visibleFrames(timeline);
  update((current) => {
    current.playing = false;
    current.frameIndex = Math.min(frames.length - 1, Math.max(0, current.frameIndex + delta));
  });
}

/** Space / play button: the <video> element in video mode, the slideshow
 * otherwise (restarting a finished slideshow from the top). */
export function transportTogglePlay(): void {
  const timeline = currentTimeline();
  if (!timeline) return;
  const video = videoIsActive(timeline) ? stageVideo() : null;
  if (video) {
    // play() rejects under autoplay policy when no user activation is present
    // (e.g. keyboard-driven toolchains); swallowing it beats an unhandled-
    // rejection overlay — the next real click succeeds.
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
    return;
  }
  const total = visibleFrames(timeline).length;
  update((current) => {
    if (!current.playing && current.frameIndex >= total - 1) current.frameIndex = 0;
    current.playing = !current.playing;
  });
}

/** One diff-viewer-style row: line-number gutter, status glyph, tokenized
 * step text (id / kind / label), and the error as its own annotation line. */
function renderStepRow(frame: ReelFrame, index: number): string {
  const failed = frame.ok === false;
  const rowClass = `step-item${failed ? ' fail' : ''}${frame.named ? ' named' : ''}`;
  const status = failed ? '✗' : frame.named ? '◈' : frame.ok ? '✓' : '·';
  const statusClass = failed ? 'fail' : frame.named ? 'named' : frame.ok ? 'ok' : 'none';
  const code = frame.named
    ? `<span class="tok-name">${escapeHtml(frame.label ?? frame.named)}</span>`
    : `<span class="tok-id">${escapeHtml(frame.stepId)}</span><span class="tok-kind">${escapeHtml(frame.kind)}</span>` +
      (frame.label ? `<span class="tok-label">${escapeHtml(frame.label)}</span>` : '');
  const error = failed
    ? `<span class="tok-error">${escapeHtml(frame.error ?? 'failed')}</span>`
    : '';
  return (
    `<div class="${rowClass}" data-index="${index}">` +
    `<span class="step-gutter">${index + 1}</span>` +
    `<span class="step-status ${statusClass}">${status}</span>` +
    `<span class="step-code">${code}${error}</span>` +
    `</div>`
  );
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
          ${
            entry.details
              ? `<details class="tech-details"><summary>Technical details</summary><p>${escapeHtml(entry.details)}</p></details>`
              : ''
          }
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
  const sig = `${runId}|${timeline.scenarioId}|${state.showAllPhases}|${frames.length}|${state.videoMode}|${timeline.videoFile ?? ''}|${state.sideTab}`;
  if (root.dataset.playerSig !== sig) {
    buildShell(root, timeline, runId, frames);
    root.dataset.playerSig = sig;
  }
  patchDynamic(root, runId, frames, videoIsActive(timeline));
}

function buildShell(
  root: HTMLElement,
  timeline: ScenarioTimeline,
  runId: string,
  frames: ReelFrame[]
): void {
  videoStartMs = undefined;
  scrubbing = false;
  frameTimes = [];
  tickTimes = [];
  cornerObserver?.disconnect();
  cornerObserver = undefined;

  const entry = state.catalog.find((candidate) => candidate.id === timeline.scenarioId);
  const outcome =
    timeline.ok === undefined
      ? ''
      : timeline.ok
        ? ' <span class="glyph-pass">✓ passed</span>'
        : ' <span class="glyph-fail">✗ failed</span>';

  const stepItems = frames.map((frame, index) => renderStepRow(frame, index)).join('');

  const named = timeline.named
    .map(
      (capture) =>
        `<figure data-file="${escapeHtml(capture.file)}"><img loading="lazy" src="${api.runFileUrl(runId, capture.file)}" alt="${escapeHtml(capture.name)}" /><figcaption>${escapeHtml(capture.name)}</figcaption></figure>`
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
            `<span class="chip${chip.includes(':') ? '' : ' extra'}" title="${escapeHtml(chip)}">${escapeHtml(facetTagLabel(chip))}</span>`
        )
        .join('')
    : '';

  const detailsBlock = entry?.details
    ? `<details class="tech-details"><summary>Technical details</summary><p>${escapeHtml(entry.details)}</p></details>`
    : '';

  const videoOn = videoIsActive(timeline);
  // Simulator lanes record video (unless --no-record); fake lanes never do —
  // omit the toggle entirely there instead of showing a permanently dead one.
  const showToggle = !!timeline.videoFile || timeline.lane === 'simulator';
  const viewToggle = showToggle
    ? `<div class="view-toggle-row"><div class="stage-tabs" role="tablist" aria-label="stage view">` +
      `<button role="tab" aria-selected="${!videoOn}" class="stage-tab${videoOn ? '' : ' active'}" data-action="view-shots">Screenshots</button>` +
      `<button role="tab" aria-selected="${videoOn}" class="stage-tab${videoOn ? ' active' : ''}" data-action="view-video" ${
        timeline.videoFile ? '' : 'disabled title="no recording for this run"'
      }>Video</button>` +
      `</div></div>`
    : '';

  const stageContent = videoOn
    ? `<video id="stage-video" playsinline src="${api.runFileUrl(runId, timeline.videoFile!)}"></video>`
    : frames.length
      ? `<img id="stage-img" alt="frame" />`
      : '<span class="empty">no screenshots in this phase filter</span>';

  const cells = videoOn
    ? ''
    : frames
        .map(
          (frame, index) =>
            `<div class="scrub-cell${frame.ok === false ? ' fail' : ''}${frame.named ? ' named' : ''}" data-cell="${index}"></div>`
        )
        .join('');

  const scrubInput = videoOn
    ? `<input type="range" data-action="scrub" aria-label="video position" min="0" step="0.1" value="0" disabled />`
    : `<input type="range" data-action="scrub" aria-label="frame" min="0" max="${Math.max(0, frames.length - 1)}" step="1" value="0" ${frames.length < 2 ? 'disabled' : ''}/>`;

  const metaRows = [
    timeline.durationMs
      ? `<span class="k">test run</span><span class="v">${fmtTime(timeline.durationMs / 1000)}</span>`
      : '',
    timeline.videoFile
      ? `<span class="k">video</span><span class="v" data-role="video-len">–:––</span>`
      : '',
    state.runDetail?.deviceType
      ? `<span class="k">device</span><span class="v">${escapeHtml(state.runDetail.deviceType)}</span>`
      : '',
    timeline.lane
      ? `<span class="k">lane</span><span class="v">${escapeHtml(timeline.lane)}</span>`
      : '',
    entry?.platforms.length
      ? `<span class="k">works on</span><span class="v">${escapeHtml(platformLabels(entry.platforms).join(' + '))}</span>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const stepsActive = state.sideTab === 'steps';
  root.innerHTML = `<div class="player">
    <div class="player-head">
      <div class="titles">
        <h1>${escapeHtml(timeline.name)}${outcome}</h1>
        <p>${escapeHtml(entry?.description ?? '')}</p>
        ${facetChips ? `<div class="facet-chips">${facetChips}</div>` : ''}
        ${detailsBlock}
      </div>
      ${metaRows ? `<div class="scenario-meta meta-strip">${metaRows}</div>` : ''}
    </div>
    <div class="stage-row">
      <div class="stage-col">
        ${viewToggle}
        <div class="stage">${stageContent}<div class="caption" data-role="caption"></div></div>
        <div class="controls">
          <button data-action="play" aria-label="${videoOn ? 'play video' : 'play slideshow'}">▶</button>
          <div class="scrubber">
            ${videoOn ? '<div class="scrub-ticks" data-role="ticks"></div>' : ''}
            <div class="scrub-track">
              <div class="scrub-cells" data-role="cells">${cells}</div>
              ${videoOn ? '<div class="scrub-playhead" data-role="playhead"></div>' : ''}
              ${scrubInput}
            </div>
          </div>
          <span class="counter" data-role="counter">${videoOn ? '–:–– / –:––' : ''}</span>
        </div>
      </div>
      <div class="side-pane">
        <div class="steps-head side-tabs" role="tablist" aria-label="side panel">
          <button role="tab" aria-selected="${stepsActive}" class="side-tab${stepsActive ? ' active' : ''}" data-side-tab="steps">Steps</button>
          <button role="tab" aria-selected="${!stepsActive}" class="side-tab${stepsActive ? '' : ' active'}" data-side-tab="state" title="per-frame zustand + coco db snapshots">State</button>
          ${
            stepsActive
              ? `<span class="steps-count">${frames.length}</span>
            <label class="check"><input type="checkbox" data-action="phases" ${state.showAllPhases ? 'checked' : ''}/> setup / cleanup</label>`
              : ''
          }
        </div>
        ${stepsActive ? `<div class="step-list">${stepItems}</div>` : renderStateBody()}
      </div>
    </div>
    ${named ? `<div class="named-strip">${named}</div>` : ''}
  </div>`;

  root.querySelector('[data-action=play]')?.addEventListener('click', () => transportTogglePlay());
  root.querySelector('[data-action=view-shots]')?.addEventListener('click', () => {
    if (!state.videoMode) return;
    update((current) => {
      current.videoMode = false;
      current.playing = false;
    });
  });
  root.querySelector('[data-action=view-video]')?.addEventListener('click', () => {
    if (state.videoMode) return;
    update((current) => {
      current.videoMode = true;
      current.playing = false;
    });
  });

  const scrub = root.querySelector<HTMLInputElement>('[data-action=scrub]');
  if (scrub) {
    scrub.addEventListener('input', () => {
      if (videoOn) {
        const video = stageVideo();
        if (video && !scrub.disabled) video.currentTime = Number(scrub.value);
        return;
      }
      update((current) => {
        current.playing = false;
        current.frameIndex = Number(scrub.value);
      });
    });
    scrub.addEventListener('pointerdown', () => {
      scrubbing = true;
    });
    const release = () => {
      scrubbing = false;
    };
    scrub.addEventListener('pointerup', release);
    scrub.addEventListener('pointercancel', release);
    if (videoOn) {
      // arrows jump between step markers, not 0.1s micro-steps
      scrub.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          transportStep(event.key === 'ArrowRight' ? 1 : -1);
        } else if (event.key === ' ') {
          event.preventDefault();
          transportTogglePlay();
        }
      });
    }
  }

  root.querySelector<HTMLInputElement>('[data-action=phases]')?.addEventListener('change', () =>
    update((current) => {
      current.showAllPhases = !current.showAllPhases;
      current.frameIndex = 0;
      current.playing = false;
    })
  );
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-side-tab]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.sideTab as AppState['sideTab'];
      if (next === state.sideTab) return;
      update((current) => {
        current.sideTab = next;
      });
    });
  }
  if (state.sideTab === 'state') bindStatePane(root);
  for (const item of root.querySelectorAll<HTMLElement>('.step-item')) {
    item.addEventListener('click', () => {
      const index = Number(item.dataset.index);
      if (videoOn) {
        const video = stageVideo();
        const sec = frameTimes[index];
        if (video && sec !== undefined) video.currentTime = sec;
        return;
      }
      update((current) => {
        current.playing = false;
        current.frameIndex = index;
      });
    });
  }
  for (const figure of root.querySelectorAll<HTMLElement>('.named-strip figure')) {
    figure.addEventListener('click', () => {
      const index = frames.findIndex((frame) => frame.file === figure.dataset.file);
      if (index < 0) return;
      if (videoOn) {
        const video = stageVideo();
        const sec = frameTimes[index];
        if (video && sec !== undefined) video.currentTime = sec;
        return;
      }
      update((current) => {
        current.playing = false;
        current.frameIndex = index;
      });
    });
  }

  if (videoOn) {
    const video = root.querySelector<HTMLVideoElement>('#stage-video');
    if (video) attachVideo(root, video, frames, timeline);
  }
  attachStageCorners(root);

  // fill "video –:––" in both modes; a metadata-only probe costs one cached
  // range request, so screenshots mode shows the length without the <video>
  if (timeline.videoFile) {
    const lenEl = root.querySelector<HTMLElement>('[data-role=video-len]');
    if (lenEl) {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = api.runFileUrl(runId, timeline.videoFile);
      probe.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(probe.duration)) lenEl.textContent = fmtTime(probe.duration);
      });
    }
  }
}

/** All video-mode dynamics run here, patching the DOM directly — never through
 * update() — so 4-60Hz timeupdate ticks cannot trigger app-wide re-renders. */
function attachVideo(
  root: HTMLElement,
  video: HTMLVideoElement,
  frames: ReelFrame[],
  timeline: ScenarioTimeline
): void {
  const input = root.querySelector<HTMLInputElement>('[data-action=scrub]');
  const ticksEl = root.querySelector<HTMLElement>('[data-role=ticks]');
  const playhead = root.querySelector<HTMLElement>('[data-role=playhead]');
  const counter = root.querySelector<HTMLElement>('[data-role=counter]');
  const captionEl = root.querySelector<HTMLElement>('[data-role=caption]');
  const playButton = root.querySelector<HTMLButtonElement>('[data-action=play]');
  if (!input) return;

  let lastNearest = -1;
  const syncTime = () => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const now = video.currentTime;
    if (playhead) playhead.style.left = `${(now / duration) * 100}%`;
    if (!scrubbing) input.value = String(now);
    if (counter) counter.textContent = `${fmtTime(now)} / ${fmtTime(duration)}`;
    const nearest = nearestFrameIndex(now);
    let valuetext = `${fmtTime(now)} of ${fmtTime(duration)}`;
    if (nearest !== undefined) {
      const frame = frames[nearest];
      valuetext += `, near ${caption(frame)} (approximate)`;
      if (nearest !== lastNearest) {
        lastNearest = nearest;
        // silent mutation: keeps the reel position in sync so toggling back to
        // screenshots lands on this step, without an update() re-render storm
        state.frameIndex = nearest;
        if (captionEl) {
          captionEl.textContent = caption(frame);
          captionEl.classList.toggle('fail', frame.ok === false);
        }
        root.querySelectorAll<HTMLElement>('.step-item').forEach((item, itemIndex) => {
          const on = itemIndex === nearest;
          item.classList.toggle('current', on);
          if (on) item.scrollIntoView({ block: 'nearest' });
        });
        for (const tick of root.querySelectorAll<HTMLElement>('.scrub-tick')) {
          tick.classList.toggle('current', Number(tick.dataset.index) === nearest);
        }
      }
    }
    input.setAttribute('aria-valuetext', valuetext);
  };

  video.addEventListener('loadedmetadata', () => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    videoStartMs =
      timeline.videoEndT !== undefined ? timeline.videoEndT - duration * 1000 : undefined;
    frameTimes = frames.map((frame) => frameTimeSec(frame, duration));
    tickTimes = frameTimes.filter((sec): sec is number => sec !== undefined).sort((a, b) => a - b);
    input.max = String(duration);
    input.disabled = false;
    if (ticksEl) {
      ticksEl.innerHTML = frames
        .map((frame, index) => {
          const sec = frameTimes[index];
          if (sec === undefined) return '';
          return `<div class="scrub-tick${frame.ok === false ? ' fail' : ''}${frame.named ? ' named' : ''}" data-index="${index}" style="left:${(sec / duration) * 100}%" title="${escapeHtml(caption(frame))} · ~${fmtTime(sec)}"></div>`;
        })
        .join('');
      for (const tick of ticksEl.querySelectorAll<HTMLElement>('.scrub-tick')) {
        tick.addEventListener('click', () => {
          const sec = frameTimes[Number(tick.dataset.index)];
          if (sec !== undefined) video.currentTime = sec;
        });
      }
    }
    // open on the step the reel was showing when the mode flipped
    const start = frameTimes[state.frameIndex];
    if (start !== undefined && start > 0.05) video.currentTime = start;
    syncTime();
  });
  video.addEventListener('timeupdate', syncTime);
  video.addEventListener('seeked', syncTime);

  const paintGlyph = () => {
    if (playButton) playButton.textContent = video.paused ? '▶' : '⏸';
  };
  video.addEventListener('play', paintGlyph);
  video.addEventListener('pause', paintGlyph);
  video.addEventListener('ended', paintGlyph);
  video.addEventListener('error', () =>
    update((current) => {
      current.videoMode = false;
      current.error = 'video failed to load; showing screenshots';
    })
  );
}

function patchDynamic(
  root: HTMLElement,
  runId: string,
  frames: ReelFrame[],
  videoOn: boolean
): void {
  // Video mode: attachVideo owns every dynamic surface (playhead, counter,
  // caption, current-step highlight, play glyph). Touching them here would let
  // unrelated update()s — e.g. SSE console lines — clobber live video state.
  if (videoOn) return;

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
  if (scrub) {
    if (Number(scrub.value) !== index) scrub.value = String(index);
    scrub.setAttribute('aria-valuetext', frame ? caption(frame) : '');
  }

  const counter = root.querySelector<HTMLElement>('[data-role=counter]');
  if (counter) counter.textContent = `${frames.length ? index + 1 : 0}/${frames.length}`;

  const play = root.querySelector<HTMLButtonElement>('[data-action=play]');
  if (play) play.textContent = state.playing ? '⏸' : '▶';

  root.querySelectorAll<HTMLElement>('.scrub-cell').forEach((cell, cellIndex) => {
    cell.classList.toggle('current', cellIndex === index);
  });

  const items = root.querySelectorAll<HTMLElement>('.step-item');
  items.forEach((item, itemIndex) => {
    item.classList.toggle('current', itemIndex === index);
    if (itemIndex === index) item.scrollIntoView({ block: 'nearest' });
  });

  // keep neighbours warm so scrubbing feels instant
  for (const neighbour of [frames[index - 1], frames[index + 1]]) {
    if (neighbour) new Image().src = api.runFileUrl(runId, neighbour.file);
  }

  if (state.sideTab === 'state') patchStatePane(root, runId, frames, index);
}
