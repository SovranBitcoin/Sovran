import { expect, test } from 'bun:test';

import { JSDOM } from 'jsdom';
import { state } from '../state';
import { renderPlayer, renderStepRow } from './player';

test('story steps expose measured delays and escaped warnings beside their result', () => {
  const row = renderStepRow(
    {
      artifactSeq: 1,
      stepId: '1',
      phase: 'T',
      kind: 'story-step',
      label: 'Next card',
      file: 'workers/1/stories/preview/1.jpg',
      ok: true,
      observations: {
        wallMs: 125,
        screenMovedMs: 30,
        appUnresponsiveMs: 500,
        touchMadeAgain: true,
        warnings: [{ level: 'warn', event: '<script>unsafe</script>' }],
      },
    },
    0
  );
  expect(row).toContain('125 ms');
  expect(row).toContain('screen moved 30 ms more');
  expect(row).toContain('app unresponsive for 500 ms');
  expect(row).toContain('touch repeated; first effect unknown');
  expect(row).toContain('warn: &lt;script&gt;unsafe&lt;/script&gt;');
  expect(row).not.toContain('<script>');
});

test('recordings open paused by default, with screenshots available and an image fallback', () => {
  const dom = new JSDOM('<div id="player"></div>');
  const root = dom.window.document.getElementById('player');
  if (!root) throw new Error('Missing player root');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalState = { ...state };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  try {
    state.catalog = [];
    state.selectedRunId = 'run-recorded';
    state.selectedScenarioId = 'story:one';
    state.runDetail = {
      runId: 'recorded',
      suite: 'stories',
      driver: 'sim',
      proof: 'product-run',
      startedAt: '',
      scenarioIds: ['story:one'],
      commitRun: false,
      label: 'recorded',
      status: 'complete',
      fundsSafeToDelete: false,
      scenarios: [
        {
          scenarioId: 'story:one',
          name: 'one',
          lane: 'stories',
          videoFile: 'workers/1/stories/one/story.mp4',
          videoEndT: 10000,
          named: [],
          frames: [
            {
              artifactSeq: 1,
              stepId: '1',
              phase: 'T',
              kind: 'story step',
              t: 7000,
              file: 'one.jpg',
            },
          ],
        },
      ],
    };
    renderPlayer(root);
    const video = root.querySelector('video');
    expect(video?.getAttribute('src')).toContain('story.mp4');
    expect(video?.paused).toBe(true);
    expect(video?.autoplay).toBe(false);
    if (!video) throw new Error('Recording missing');
    Object.defineProperty(video, 'duration', { value: 10 });
    video.dispatchEvent(new dom.window.Event('loadedmetadata'));
    expect(video.currentTime).toBe(0);
    expect(root.querySelector('[data-action=view-video]')?.getAttribute('aria-selected')).toBe(
      'true'
    );
    root.querySelector<HTMLButtonElement>('[data-action=view-shots]')?.click();
    renderPlayer(root);
    expect(root.querySelector('#stage-img')?.getAttribute('src')).toContain('one.jpg');
    root.querySelector<HTMLButtonElement>('[data-action=view-video]')?.click();
    renderPlayer(root);
    expect(root.querySelector('#stage-video')).not.toBeNull();
    // Manual reviews have pictures only and must not lose the video preference.
    state.runDetail.proof = 'manual-review';
    state.runDetail.scenarios[0].videoFile = undefined;
    renderPlayer(root);
    expect(root.querySelector('#stage-img')?.getAttribute('src')).toContain('one.jpg');
    expect(root.querySelector('#stage-video')).toBeNull();
    expect(state.videoMode).toBe(true);
  } finally {
    Object.assign(state, originalState);
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    dom.window.close();
  }
});
