import { expect, test } from 'bun:test';
import { runReportPage, type StoryReport } from './runReport';

const report = (fields: Partial<StoryReport>): StoryReport => ({
  id: 'send-ecash',
  purpose: 'A person sends 40 sat as ecash and sees it leave the balance.',
  startsFrom: 'funded',
  ok: true,
  video: 'story.mp4',
  spentMs: { startState: 1000, steps: 2500 },
  steps: [
    {
      name: 'open Send',
      ok: true,
      wallMs: 400,
      screenMovedMs: 120,
      picture: '01-open-send.jpg',
      entries: [],
    },
  ],
  ...fields,
});

test('each story shows its purpose, where it starts, its time, its video and a picture per step', () => {
  const page = runReportPage([{ folder: 'send-ecash', report: report({}) }]);

  expect(page).toContain('1 of 1 stories passed');
  expect(page).toContain('A person sends 40 sat as ecash and sees it leave the balance.');
  expect(page).toContain('starts from <b>funded</b>');
  expect(page).toContain('3.5 s in all, 0.4 s of it in the steps');
  expect(page).toContain('src="send-ecash/story.mp4"');
  expect(page).toContain('src="send-ecash/01-open-send.jpg"');
  expect(page).toContain('400 ms · screen moved 120 ms more');
});

test('a failed story comes first and says which step failed and why', () => {
  const failed = report({
    ok: false,
    steps: [
      {
        name: 'press Next',
        ok: false,
        wallMs: 5000,
        failure: 'Nothing to tap: {"id":"amount-next"} is not on screen',
        entries: [],
      },
    ],
  });
  const page = runReportPage([
    { folder: 'a-passing-story', report: report({}) },
    { folder: 'send-ecash', report: failed },
  ]);

  expect(page).toContain('1 of 2 stories passed');
  expect(page).toContain('Failed: <a href="#send-ecash">send-ecash</a>');
  expect(page.indexOf('id="send-ecash"')).toBeLessThan(page.indexOf('id="a-passing-story"'));
  expect(page).toContain('Nothing to tap: {&#34;id&#34;:&#34;amount-next&#34;} is not on screen');
  expect(page).toContain('no picture');
});

test('the warnings and errors the app logged during a step are listed under it, counted', () => {
  const noisy = report({
    steps: [
      {
        name: 'the wallet opens',
        ok: true,
        wallMs: 3000,
        screenKeptMoving: true,
        picture: '01.jpg',
        entries: [
          { level: 'info', event: 'screen.mount' },
          { level: 'warn', event: 'nostr.relay.failed' },
          { level: 'warn', event: 'bg.sprite.image_missing' },
          { level: 'warn', event: 'bg.sprite.image_missing' },
          { level: 'error', event: 'theme.token.unresolved' },
        ],
      },
    ],
  });
  const page = runReportPage([{ folder: 'open-an-empty-wallet', report: noisy }]);

  expect(page).toContain('<li>warn bg.sprite.image_missing ×2</li>');
  expect(page).toContain('<li>warn nostr.relay.failed</li>');
  expect(page).toContain('<li>error theme.token.unresolved</li>');
  expect(page).not.toContain('screen.mount');
  expect(page).toContain('screen never stopped moving');
});

test('text from a story cannot become markup', () => {
  const page = runReportPage([
    {
      folder: 'x',
      report: report({ purpose: 'A person types <script>alert(1)</script> as a note.' }),
    },
  ]);

  expect(page).not.toContain('<script>');
});
