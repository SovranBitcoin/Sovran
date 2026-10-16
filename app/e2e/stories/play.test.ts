import { describe, expect, test } from 'bun:test';
import type { AppLink, AppLogEntry, AppScreen } from '../link/appLink';
import { find, playStory, topPage } from './play';
import { storySchema, type Story } from './story';

type Element = AppScreen['elements'][number];
const box = (fields: Partial<Element>): Element => ({
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...fields,
});
const screenOf = (...elements: Element[]): AppScreen => ({
  appClockMs: 0,
  width: 400,
  height: 800,
  elements,
});

/** An app that shows `screen`, and logs what a test tells it to. */
function fakeApp(initial: AppScreen) {
  const entries: AppLogEntry[] = [];
  const watchers = new Set<() => void>();
  const state = { screen: initial, taps: [] as [number, number][], clock: 0 };
  const log = (event: string, params?: Record<string, unknown>) => {
    const entry: AppLogEntry = { _t: (state.clock += 10), level: 'debug', event, params };
    entries.push(entry);
    for (const watcher of [...watchers]) watcher();
    return entry;
  };
  const link: AppLink = {
    url: 'ws://127.0.0.1:1',
    entries,
    connected: async () => ({ run: 'r', platform: 'ios', appClockMs: 0 }),
    mark: async (step) => log('e2e.step', { step }),
    still: async () => ({ appClockMs: state.clock, forced: false }),
    screen: async () => state.screen,
    waitFor: (matches, { timeoutMs, from = 0 }) =>
      new Promise((resolve, reject) => {
        let next = from;
        const check = () => {
          for (; next < entries.length; next++)
            if (matches(entries[next])) {
              clearTimeout(timer);
              watchers.delete(check);
              return resolve(entries[next]);
            }
        };
        const timer = setTimeout(() => {
          watchers.delete(check);
          reject(new Error('timed out'));
        }, timeoutMs);
        watchers.add(check);
        check();
      }),
    close() {},
  };
  return { link, state, log };
}

const story = (steps: unknown[]): Story =>
  storySchema.parse({
    id: 'send-ecash',
    purpose: 'A person opens Send from the wallet home and sees the ways to pay.',
    startsFrom: 'fresh',
    steps,
  });
const noSwipe = { swipe: async () => {}, type: async () => {} };

describe('find', () => {
  test('takes the last match, which is the one drawn on top', () => {
    const screen = screenOf(
      box({ id: 'close', page: 'WalletScreen', y: 10 }),
      box({ id: 'close', page: 'SendScreen', y: 90 })
    );

    expect(find({ id: 'close' }, screen)?.page).toBe('SendScreen');
  });

  test('matches a label against the accessibility label or the text drawn', () => {
    const screen = screenOf(box({ label: 'Send' }), box({ text: 'Create Ecash' }));

    expect(find({ label: 'Send' }, screen)?.label).toBe('Send');
    expect(find({ label: 'Create Ecash' }, screen)?.text).toBe('Create Ecash');
  });

  test('ignores an element that is laid out with no size', () => {
    expect(find({ id: 'ghost' }, screenOf(box({ id: 'ghost', width: 0 })))).toBeNull();
  });
});

test('topPage is the page of the last element laid out', () => {
  expect(
    topPage(screenOf(box({ page: 'WalletScreen' }), box({ page: 'SendScreen' }), box({})))
  ).toBe('SendScreen');
});

describe('playStory', () => {
  test('taps the centre of the control once and passes when what it expects is true', async () => {
    const app = fakeApp(screenOf(box({ id: 'wallet-send', page: 'WalletScreen', x: 100, y: 600 })));
    const device = {
      ...noSwipe,
      tap: async (x: number, y: number) => {
        app.state.taps.push([x, y]);
        app.state.screen = screenOf(box({ id: 'send-method-createEcash', page: 'SendScreen' }));
      },
    };

    const result = await playStory(
      story([
        {
          name: 'open Send',
          tap: { id: 'wallet-send' },
          expect: [{ page: 'SendScreen' }, { visible: { id: 'send-method-createEcash' } }],
        },
      ]),
      app.link,
      device
    );

    expect(result.ok).toBe(true);
    expect(app.state.taps).toEqual([[0.375, 0.78125]]);
    expect(result.steps[0].entries.map((entry) => entry.params?.step)).toEqual([
      '1-open Send:sent',
    ]);
  });

  test('taps where the step says when part of the control is covered', async () => {
    const app = fakeApp(screenOf(box({ id: 'get-started', x: 100, y: 600 })));
    const device = {
      ...noSwipe,
      tap: async (x: number, y: number) => void app.state.taps.push([x, y]),
    };

    await playStory(
      story([
        {
          name: 'press the part that shows',
          tap: { id: 'get-started' },
          tapAt: [0.5, 1],
          expect: [{ visible: { id: 'get-started' } }],
        },
      ]),
      app.link,
      device
    );

    const centre = 0.78125;
    expect(app.state.taps[0][0]).toBe(0.375);
    expect(app.state.taps[0][1]).toBeGreaterThan(centre);
  });

  test('drags a finger from the middle of an element in the direction asked', async () => {
    const app = fakeApp(screenOf(box({ id: 'slides', x: 0, y: 0, width: 400, height: 800 })));
    const swipes: [number, number][][] = [];
    const device = {
      ...noSwipe,
      tap: async () => {},
      swipe: async (from: [number, number], to: [number, number]) => void swipes.push([from, to]),
    };

    await playStory(
      story([
        {
          name: 'lift the slides',
          swipe: { on: { id: 'slides' }, direction: 'up', distance: 0.25 },
          expect: [{ visible: { id: 'slides' } }],
        },
      ]),
      app.link,
      device
    );

    expect(swipes).toEqual([
      [
        [0.5, 0.5],
        [0.5, 0.25],
      ],
    ]);
  });

  test('a step that asks for a tap and a swipe is refused', () => {
    expect(() =>
      story([
        {
          name: 'both',
          tap: { id: 'a' },
          swipe: { on: { id: 'a' }, direction: 'up' },
          expect: [{ page: 'X' }],
        },
      ])
    ).toThrow(/A step does one thing/);
  });

  test('taps a control iOS drew itself, found by its label, when the app does not have it', async () => {
    const app = fakeApp(screenOf(box({ id: 'wallet-unit-switcher' })));
    const asked: string[] = [];
    const device = {
      ...noSwipe,
      tap: async (x: number, y: number) => void app.state.taps.push([x, y]),
      findSystemControl: async (label: string) => {
        asked.push(label);
        return { x: 0.2, y: 0.3, width: 0.4, height: 0.1 };
      },
    };

    const result = await playStory(
      story([
        {
          name: 'pick the account',
          tap: { label: 'Test Bitcoin account' },
          expect: [{ visible: { id: 'wallet-unit-switcher' } }],
        },
      ]),
      app.link,
      device
    );

    expect(result.ok).toBe(true);
    // Looked for until two looks agree on where it is: a menu moves as it opens.
    expect(asked).toEqual(['Test Bitcoin account', 'Test Bitcoin account']);
    expect(app.state.taps[0][0]).toBeCloseTo(0.4);
    expect(app.state.taps[0][1]).toBeCloseTo(0.35);
  });

  test('remembers what a step read off the screen and taps the choice that ends with it', async () => {
    const app = fakeApp(screenOf(box({ id: 'backup-word-1', label: 'Word 1, extra' })));
    const device = {
      ...noSwipe,
      tap: async (x: number, y: number) => {
        app.state.taps.push([x, y]);
        // The check: choices in an order nobody knows beforehand.
        app.state.screen = screenOf(
          box({ id: 'backup-choice-0', label: 'Option 1, fun', y: 100 }),
          box({ id: 'backup-choice-1', label: 'Option 2, extra', y: 200 })
        );
      },
    };

    const result = await playStory(
      story([
        {
          name: 'read the first word',
          expect: [{ visible: { id: 'backup-word-1' } }],
          remember: [{ as: 'word1', from: { id: 'backup-word-1' }, after: ', ' }],
        },
        {
          name: 'say they are written',
          tap: { id: 'backup-word-1' },
          expect: [{ visible: { id: 'backup-choice-0' } }],
        },
        {
          name: 'pick the first word',
          tap: { labelEnds: ', {{word1}}' },
          expect: [{ visible: { id: 'backup-choice-1' } }],
        },
      ]),
      app.link,
      device
    );

    expect(result.ok).toBe(true);
    // The second tap landed on "Option 2, extra", 200 down, not on "Option 1, fun".
    expect(app.state.taps[1][1]).toBeCloseTo((200 + 25) / 800);
  });

  test('a key read from a row is what handed ecash is locked to, and the link opened carries the token', async () => {
    const app = fakeApp(screenOf(box({ id: 'keyring-key-copy-02ab', label: 'Copy key' })));
    const opened: string[] = [];
    const asked: unknown[] = [];
    const device = {
      ...noSwipe,
      tap: async () => {},
      open: async (url: string) => void opened.push(url),
    };

    const result = await playStory(
      story([
        {
          name: 'read the key',
          expect: [{ visible: { id: 'keyring-key-copy-02ab' } }],
          remember: [{ as: 'myKey', idAfter: 'keyring-key-copy-' }],
        },
        {
          name: 'open a link someone sent',
          handed: { token: { sats: 16, lockTo: '{{myKey}}' } },
          open: 'cashu:{{token}}',
          expect: [{ visible: { id: 'keyring-key-copy-02ab' } }],
        },
      ]),
      app.link,
      device,
      undefined,
      undefined,
      async (what) => {
        asked.push(what);
        return { token: 'cashuBabc' };
      }
    );

    expect(result.ok).toBe(true);
    expect(asked).toEqual([{ token: { sats: 16, lockTo: '02ab' } }]);
    expect(opened).toEqual(['cashu:cashuBabc']);
  });

  test('a step that hands something fails where nothing can make it', async () => {
    const app = fakeApp(screenOf(box({ id: 'wallet-send' })));
    const result = await playStory(
      story([
        {
          name: 'open a link someone sent',
          handed: { token: { sats: 16 } },
          open: 'cashu:{{token}}',
          expect: [{ visible: { id: 'wallet-send' } }],
        },
      ]),
      app.link,
      { ...noSwipe, tap: async () => {}, open: async () => {} }
    );
    expect(result.steps[0].failure).toMatch(/hand/);
  });

  test('missing touch feedback fails the expectation without issuing the action again', async () => {
    const app = fakeApp(screenOf(box({ id: 'receive-method-paste' })));
    let touches = 0;
    const device = {
      ...noSwipe,
      tap: async () => {
        touches += 1;
        // A second action could appear to fix the test while duplicating an unseen effect.
        if (touches === 2) app.state.screen = screenOf(box({ id: 'receive-token-redeem' }));
      },
    };
    const pixels = {
      pixelsStill: async () => ({ movedForMs: 0, stillMoving: false }),
      changedSince: () => touches >= 2,
    };

    const result = await playStory(
      story([
        {
          name: 'paste',
          withinMs: 100,
          tap: { id: 'receive-method-paste' },
          expect: [{ visible: { id: 'receive-token-redeem' } }],
        },
      ]),
      app.link,
      device,
      pixels
    );

    expect(result.ok).toBe(false);
    expect(touches).toBe(1);
    expect(result.steps[0].failure).toContain('receive-token-redeem');
  });

  test('an action with an unchanged screen and missing log still happens only once', async () => {
    const app = fakeApp(screenOf(box({ id: 'publish' })));
    let publications = 0;
    const pixels = { pixelsStill: async () => ({ movedForMs: 0, stillMoving: false }), changedSince: () => false };
    const result = await playStory(
      story([{ name: 'publish', tap: { id: 'publish' }, expect: [{ visible: { id: 'publish' } }] }]),
      app.link,
      { ...noSwipe, tap: async () => { publications += 1; } },
      pixels
    );
    expect(result.ok).toBe(true);
    expect(publications).toBe(1);
  });

  test('a touch that changed the screen is not made again', async () => {
    const app = fakeApp(screenOf(box({ id: 'wallet-more' })));
    let touches = 0;
    const device = { ...noSwipe, tap: async () => void (touches += 1) };
    const pixels = {
      pixelsStill: async () => ({ movedForMs: 0, stillMoving: false }),
      // A menu iOS draws: the app logs no touch, but the screen changes.
      changedSince: () => touches >= 1,
    };

    await playStory(
      story([
        {
          name: 'open More',
          tap: { id: 'wallet-more' },
          expect: [{ visible: { id: 'wallet-more' } }],
        },
      ]),
      app.link,
      device,
      pixels
    );

    expect(touches).toBe(1);
  });

  test('does not touch the screen when the control is missing or disabled', async () => {
    const app = fakeApp(screenOf(box({ id: 'amount-next', disabled: true })));
    const device = { ...noSwipe, tap: async () => void app.state.taps.push([0, 0]) };
    const tapStep = (id: string) => ({ name: 'press it', tap: { id }, expect: [{ page: 'X' }] });

    const disabled = await playStory(story([tapStep('amount-next')]), app.link, device);
    const missing = await playStory(story([tapStep('nowhere')]), app.link, device);

    expect(disabled.steps[0].failure).toBe('Cannot tap {"id":"amount-next"}: it is disabled');
    expect(missing.steps[0].failure).toBe('Nothing to tap: {"id":"nowhere"} is not on screen');
    expect(app.state.taps).toEqual([]);
  });

  test('waits for the app to log what the step expects, however long the mint takes', async () => {
    const app = fakeApp(screenOf(box({ id: 'receive-copy', page: 'ReceiveScreen' })));
    setTimeout(() => app.log('nostr.relay.resolved'), 20);
    setTimeout(() => app.log('payment.receive.confirmed', { amount: 100 }), 60);

    const result = await playStory(
      story([
        {
          name: 'wait for the payment',
          expect: [{ logged: 'payment.receive.confirmed', with: { amount: 100 } }],
          withinMs: 2000,
        },
      ]),
      app.link,
      { ...noSwipe, tap: async () => {} }
    );

    expect(result.ok).toBe(true);
    expect(result.steps[0].wallMs).toBeLessThan(1000);
  });

  test('fails at the deadline, saying what was wrong and what was on screen', async () => {
    const app = fakeApp(screenOf(box({ id: 'wallet-send', page: 'WalletScreen' })));

    const result = await playStory(
      story([{ name: 'look for Send', expect: [{ page: 'SendScreen' }], withinMs: 100 }]),
      app.link,
      { ...noSwipe, tap: async () => {} }
    );

    expect(result.ok).toBe(false);
    expect(result.steps[0].failure).toBe(
      'the page on top is WalletScreen, not SendScreen. On screen: wallet-send'
    );
  });

  test('stops at the first step that fails', async () => {
    const app = fakeApp(screenOf(box({ id: 'wallet-send', page: 'WalletScreen' })));

    const result = await playStory(
      story([
        { name: 'first', expect: [{ gone: { id: 'wallet-send' } }], withinMs: 100 },
        { name: 'second', expect: [{ page: 'WalletScreen' }] },
      ]),
      app.link,
      { ...noSwipe, tap: async () => {} }
    );

    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([['first', false]]);
  });
});
