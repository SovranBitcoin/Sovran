import { expect, test } from 'bun:test';

import { renderStepRow } from './player';

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
  expect(row).toContain('first touch not taken; touch repeated');
  expect(row).toContain('warn: &lt;script&gt;unsafe&lt;/script&gt;');
  expect(row).not.toContain('<script>');
});
