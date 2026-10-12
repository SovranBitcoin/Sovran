/**
 * The link from the end-to-end test build to its runner.
 *
 * The runner leaves a note in the app's own folder saying where it listens.
 * The app sends it every log entry as it happens, and writes the runner's step
 * marks into the same log, so each entry can be placed in a step by the app's
 * clock.
 */
import type { LogEntry } from '@/shared/lib/loggerCore';
import {
  connectRunnerLink,
  createSettleWatch,
  parseRunnerNote,
  type RunnerRequests,
  type RunnerSocket,
} from '@/shared/lib/loggerRunnerLink';

const entry = (event: string): LogEntry => ({
  ts: '2026-10-12T18:00:00.000Z',
  _t: 1,
  level: 'debug',
  event,
  src: { file: 'test', func: 'test', line: 1 },
});

class FakeSocket implements RunnerSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  messages() {
    return this.sent.map((text) => JSON.parse(text) as { type: string; entry?: LogEntry });
  }
}

describe('parseRunnerNote', () => {
  it('reads where the runner listens on this machine', () => {
    expect(parseRunnerNote('{"url":"ws://127.0.0.1:41234","run":"r1"}')).toEqual({
      url: 'ws://127.0.0.1:41234',
      run: 'r1',
    });
    expect(parseRunnerNote('{"url":"ws://10.0.2.2:41234","run":"r1"}')?.url).toBe(
      'ws://10.0.2.2:41234'
    );
  });

  it('refuses an address that is not this machine', () => {
    expect(parseRunnerNote('{"url":"ws://203.0.113.9:41234","run":"r1"}')).toBeNull();
    expect(parseRunnerNote('{"url":"wss://example.com/logs","run":"r1"}')).toBeNull();
  });

  it('has nothing to return for a missing or damaged note', () => {
    expect(parseRunnerNote(null)).toBeNull();
    expect(parseRunnerNote('{not json')).toBeNull();
    expect(parseRunnerNote('{"run":"r1"}')).toBeNull();
  });
});

const requests = (over: Partial<RunnerRequests> = {}): RunnerRequests => ({
  onMark: jest.fn(),
  readScreen: () => ({ elements: [] }),
  whenStill: jest.fn(),
  ...over,
});

describe('connectRunnerLink', () => {
  it('holds entries logged before the runner answers and sends them in order', () => {
    const socket = new FakeSocket();
    const link = connectRunnerLink(
      { url: 'ws://127.0.0.1:1', run: 'r1' },
      () => socket,
      requests()
    );

    link.transport(entry('app.first'));
    link.transport(entry('app.second'));
    expect(socket.sent).toEqual([]);

    socket.onopen?.();
    link.transport(entry('app.third'));

    expect(socket.messages().map((message) => message.entry?.event ?? message.type)).toEqual([
      'hello',
      'app.first',
      'app.second',
      'app.third',
    ]);
  });

  it("writes the runner's step mark into the app's log", () => {
    const socket = new FakeSocket();
    const onMark = jest.fn();
    connectRunnerLink({ url: 'ws://127.0.0.1:1', run: 'r1' }, () => socket, requests({ onMark }));
    socket.onopen?.();

    socket.onmessage?.({ data: '{"type":"mark","step":"3-tap-send"}' });
    socket.onmessage?.({ data: '{"type":"mark","step":7}' });
    socket.onmessage?.({ data: 'not json' });

    expect(onMark).toHaveBeenCalledTimes(1);
    expect(onMark).toHaveBeenCalledWith('3-tap-send');
  });

  it('answers a request for where the controls are, under the id it was asked with', () => {
    const socket = new FakeSocket();
    const screen = { width: 402, height: 874, elements: [{ id: 'wallet-send', x: 1, y: 2 }] };
    connectRunnerLink(
      { url: 'ws://127.0.0.1:1', run: 'r1' },
      () => socket,
      requests({ readScreen: () => screen })
    );
    socket.onopen?.();

    socket.onmessage?.({ data: '{"type":"elements","id":7}' });

    expect(JSON.parse(socket.sent.at(-1) ?? '')).toEqual({ type: 'elements', id: 7, ...screen });
  });

  it('answers whether the screen is still when the app says it is', () => {
    const socket = new FakeSocket();
    let reply: ((report: { appClockMs: number; forced: boolean }) => void) | undefined;
    connectRunnerLink(
      { url: 'ws://127.0.0.1:1', run: 'r1' },
      () => socket,
      requests({ whenStill: (callback) => (reply = callback) })
    );
    socket.onopen?.();

    socket.onmessage?.({ data: '{"type":"still","id":4}' });
    expect(socket.messages().map((message) => message.type)).toEqual(['hello']);
    reply?.({ appClockMs: 512, forced: false });

    expect(JSON.parse(socket.sent.at(-1) ?? '')).toEqual({
      type: 'still',
      id: 4,
      appClockMs: 512,
      forced: false,
    });
  });

  it('stops sending once the runner has gone', () => {
    const socket = new FakeSocket();
    const link = connectRunnerLink(
      { url: 'ws://127.0.0.1:1', run: 'r1' },
      () => socket,
      requests()
    );
    socket.onopen?.();
    socket.onclose?.();

    link.transport(entry('app.after_runner_left'));

    expect(socket.messages().map((message) => message.type)).toEqual(['hello']);
  });
});

describe('createSettleWatch', () => {
  /** Frames run only when the test says so. */
  function harness(startsUnderSplash = false) {
    const frames: (() => void)[] = [];
    const answers: { appClockMs: number; forced: boolean }[] = [];
    let clock = 0;
    const watch = createSettleWatch({
      nextFrame: (callback) => frames.push(callback),
      now: () => clock,
      startsUnderSplash,
    });
    return {
      watch,
      answers,
      ask: () => watch.whenStill((report) => answers.push(report)),
      framesWaiting: () => frames.length,
      frame(ms = 16) {
        clock += ms;
        frames.shift()?.();
      },
    };
  }

  it('answers at once when nothing is happening on screen', () => {
    const { ask, answers, framesWaiting } = harness();

    ask();

    expect(answers).toEqual([{ appClockMs: 0, forced: false }]);
    expect(framesWaiting()).toBe(0);
  });

  it('answers once the screen has been still for two frames', () => {
    const { watch, ask, answers, frame } = harness();

    watch.note(entry('screen.mount'));
    ask();
    frame();
    expect(answers).toEqual([]);
    frame();
    frame();

    expect(answers).toEqual([{ appClockMs: 48, forced: false }]);
  });

  it('starts counting again when something else happens on screen', () => {
    const { watch, ask, answers, frame } = harness();

    watch.note(entry('screen.mount'));
    ask();
    frame();
    frame();
    watch.note(entry('visual.layout.measure'));
    frame();
    expect(answers).toEqual([]);
    frame();
    frame();

    expect(answers).toEqual([{ appClockMs: 80, forced: false }]);
  });

  it('does not answer while a page is still sliding in', () => {
    const { watch, ask, answers, frame } = harness();

    watch.note(entry('nav.transition.start'));
    ask();
    for (let i = 0; i < 10; i++) frame();
    expect(answers).toEqual([]);

    watch.note(entry('nav.transition.end'));
    frame();
    frame();
    frame();

    expect(answers).toEqual([{ appClockMs: 208, forced: false }]);
  });

  it('does not answer while a page has drawn its frame but not its content', () => {
    const { watch, ask, answers, frame } = harness();

    watch.note(entry('screen.shell'));
    ask();
    for (let i = 0; i < 10; i++) frame();
    expect(answers).toEqual([]);

    watch.note(entry('screen.mount'));
    frame();
    frame();
    frame();

    expect(answers).toEqual([{ appClockMs: 208, forced: false }]);
  });

  it('gives up on a slide that never reports its end, and says it did', () => {
    const { watch, ask, answers, frame } = harness();

    watch.note(entry('nav.transition.start'));
    ask();
    frame(1000);
    frame(1000);
    expect(answers).toEqual([]);
    frame(1000);

    expect(answers).toEqual([{ appClockMs: 3000, forced: true }]);
  });

  it('does not answer while the splash still covers the app, however still it is', () => {
    const { watch, ask, answers, frame } = harness(true);

    ask();
    for (let i = 0; i < 20; i++) frame();
    expect(answers).toEqual([]);

    watch.note(entry('splash.gone'));
    frame();
    frame();
    frame();

    expect(answers).toEqual([{ appClockMs: 368, forced: false }]);
  });

  it('gives up on a splash that never reports it has gone, and says it did', () => {
    const { ask, answers, frame } = harness(true);

    ask();
    for (let i = 0; i < 14; i++) frame(1000);
    expect(answers).toEqual([]);
    frame(1000);

    expect(answers).toEqual([{ appClockMs: 15000, forced: true }]);
  });

  it('is not woken by background work', () => {
    const { watch, ask, answers, framesWaiting } = harness();

    watch.note(entry('nostr.relay.resolved'));
    watch.note(entry('coco.manager.RequestRateLimiter.RequestRateLimiter.mint_request'));
    watch.note(entry('cache.store.write'));
    ask();

    expect(framesWaiting()).toBe(0);
    expect(answers).toEqual([{ appClockMs: 0, forced: false }]);
  });

  it('answers everyone who asked, once, and then runs no frame loop', () => {
    const { watch, ask, answers, frame, framesWaiting } = harness();

    watch.note(entry('e2e.step'));
    ask();
    ask();
    frame();
    frame();
    frame();
    frame();

    expect(answers).toEqual([
      { appClockMs: 48, forced: false },
      { appClockMs: 48, forced: false },
    ]);
    expect(framesWaiting()).toBe(0);
  });
});
