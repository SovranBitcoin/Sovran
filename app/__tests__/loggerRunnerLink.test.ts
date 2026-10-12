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
  function harness() {
    const frames: (() => void)[] = [];
    const settled: { appClockMs: number; forced: boolean }[] = [];
    let clock = 0;
    const watch = createSettleWatch({
      nextFrame: (callback) => frames.push(callback),
      now: () => clock,
      onSettled: (report) => settled.push(report),
    });
    return {
      watch,
      settled,
      framesWaiting: () => frames.length,
      frame(ms = 16) {
        clock += ms;
        frames.shift()?.();
      },
    };
  }

  it('reports once the screen has been still for two frames', () => {
    const { watch, settled, frame } = harness();

    watch.note(entry('screen.mount'));
    frame();
    expect(settled).toEqual([]);
    frame();
    frame();

    expect(settled).toEqual([{ appClockMs: 48, forced: false }]);
  });

  it('starts counting again when something else happens on screen', () => {
    const { watch, settled, frame } = harness();

    watch.note(entry('screen.mount'));
    frame();
    frame();
    watch.note(entry('visual.layout.measure'));
    frame();
    expect(settled).toEqual([]);
    frame();
    frame();

    expect(settled).toEqual([{ appClockMs: 80, forced: false }]);
  });

  it('does not report while a page is still sliding in', () => {
    const { watch, settled, frame } = harness();

    watch.note(entry('nav.transition.start'));
    for (let i = 0; i < 10; i++) frame();
    expect(settled).toEqual([]);

    watch.note(entry('nav.transition.end'));
    frame();
    frame();
    frame();

    expect(settled).toEqual([{ appClockMs: 208, forced: false }]);
  });

  it('gives up on a slide that never reports its end, and says it did', () => {
    const { watch, settled, frame } = harness();

    watch.note(entry('nav.transition.start'));
    frame(1000);
    frame(1000);
    expect(settled).toEqual([]);
    frame(1000);

    expect(settled).toEqual([{ appClockMs: 3000, forced: true }]);
  });

  it('is not woken by background work', () => {
    const { watch, settled, framesWaiting } = harness();

    watch.note(entry('nostr.relay.resolved'));
    watch.note(entry('coco.manager.RequestRateLimiter.RequestRateLimiter.mint_request'));
    watch.note(entry('cache.store.write'));

    expect(framesWaiting()).toBe(0);
    expect(settled).toEqual([]);
  });

  it('runs no frame loop once it has reported', () => {
    const { watch, frame, framesWaiting } = harness();

    watch.note(entry('e2e.step'));
    frame();
    frame();
    frame();

    expect(framesWaiting()).toBe(0);
  });
});
