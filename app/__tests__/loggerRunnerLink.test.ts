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
  parseRunnerNote,
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

describe('connectRunnerLink', () => {
  it('holds entries logged before the runner answers and sends them in order', () => {
    const socket = new FakeSocket();
    const link = connectRunnerLink({ url: 'ws://127.0.0.1:1', run: 'r1' }, () => socket, jest.fn());

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
    connectRunnerLink({ url: 'ws://127.0.0.1:1', run: 'r1' }, () => socket, onMark);
    socket.onopen?.();

    socket.onmessage?.({ data: '{"type":"mark","step":"3-tap-send"}' });
    socket.onmessage?.({ data: '{"type":"mark","step":7}' });
    socket.onmessage?.({ data: 'not json' });

    expect(onMark).toHaveBeenCalledTimes(1);
    expect(onMark).toHaveBeenCalledWith('3-tap-send');
  });

  it('stops sending once the runner has gone', () => {
    const socket = new FakeSocket();
    const link = connectRunnerLink({ url: 'ws://127.0.0.1:1', run: 'r1' }, () => socket, jest.fn());
    socket.onopen?.();
    socket.onclose?.();

    link.transport(entry('app.after_runner_left'));

    expect(socket.messages().map((message) => message.type)).toEqual(['hello']);
  });
});
