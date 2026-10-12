import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAppLink, writeRunnerNote, type AppLink } from './appLink';

let link: AppLink | undefined;
let socket: WebSocket | undefined;
afterEach(() => {
  socket?.close();
  link?.close();
});

/** Stands in for the app: connects, says hello, and logs each step mark it is sent. */
function connectApp(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const app = new WebSocket(url);
    let clock = 100;
    app.onerror = () => reject(new Error('could not connect'));
    app.onopen = () => {
      app.send(JSON.stringify({ type: 'hello', run: 'r1', platform: 'ios', appClockMs: clock }));
      resolve(app);
    };
    app.onmessage = (message) => {
      const { type, step } = JSON.parse(String(message.data));
      if (type === 'mark')
        app.send(
          JSON.stringify({
            type: 'log',
            entry: { _t: (clock += 10), level: 'info', event: 'e2e.step', params: { step } },
          })
        );
    };
  });
}

const log = (app: WebSocket, event: string, _t: number, params?: Record<string, unknown>) =>
  app.send(JSON.stringify({ type: 'log', entry: { _t, level: 'debug', event, params } }));

describe('the runner end of the app link', () => {
  test('knows the app has connected, and which run it belongs to', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);

    expect(await link.connected(1000)).toEqual({ run: 'r1', platform: 'ios', appClockMs: 100 });
  });

  test('a wait resolves on the entry it names, whether that came before or after asking', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);
    await link.connected(1000);

    log(socket, 'screen.mount', 250, { screen: 'SendScreen' });
    const early = await link.waitFor((entry) => entry.event === 'screen.mount', {
      timeoutMs: 1000,
      what: 'a page',
    });
    const late = link.waitFor((entry) => entry.params?.screen === 'AmountFlowScreen', {
      timeoutMs: 1000,
      from: link.entries.length,
      what: 'the amount page',
    });
    log(socket, 'screen.mount', 400, { screen: 'AmountFlowScreen' });

    expect(early.params).toEqual({ screen: 'SendScreen' });
    expect((await late)._t).toBe(400);
  });

  test('a wait does not match an entry from before the step it belongs to', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);
    await link.connected(1000);
    log(socket, 'screen.mount', 250, { screen: 'SendScreen' });
    await link.waitFor((entry) => entry.event === 'screen.mount', { timeoutMs: 1000, what: 'it' });

    const again = link.waitFor((entry) => entry.event === 'screen.mount', {
      timeoutMs: 60,
      from: link.entries.length,
      what: 'the send page to open again',
    });

    expect(again).rejects.toThrow(
      'Waited 60 ms for the send page to open again. The app last logged: screen.mount'
    );
  });

  test('a step mark comes back as an entry in the app log, on the app clock', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);
    await link.connected(1000);

    const mark = await link.mark('2-tap-send');

    expect(mark).toEqual({
      _t: 110,
      level: 'info',
      event: 'e2e.step',
      params: { step: '2-tap-send' },
    });
    expect(link.entries.at(-1)).toEqual(mark);
  });

  test('settled resolves on the report that follows what the step did, not an older one', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);
    await link.connected(1000);
    socket.send(JSON.stringify({ type: 'settled', appClockMs: 120, forced: false }));
    log(socket, 'screen.mount', 250, { screen: 'SendScreen' });
    await link.waitFor((entry) => entry.event === 'screen.mount', { timeoutMs: 1000, what: 'it' });

    const settled = link.settled({ timeoutMs: 1000 });
    socket.send(JSON.stringify({ type: 'settled', appClockMs: 290, forced: false }));

    expect(await settled).toEqual({ appClockMs: 290, forced: false });
  });

  test('settled does not wait again for a report that already followed the entries', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);
    await link.connected(1000);
    const from = link.entries.length;
    log(socket, 'screen.mount', 250, { screen: 'SendScreen' });
    socket.send(JSON.stringify({ type: 'settled', appClockMs: 290, forced: true }));
    await link.waitFor((entry) => entry.event === 'screen.mount', { timeoutMs: 1000, what: 'it' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await link.settled({ timeoutMs: 50, from: from + 1 })).toEqual({
      appClockMs: 290,
      forced: true,
    });
  });

  test('waiting with no app connected says so', async () => {
    link = startAppLink();

    expect(link.connected(40)).rejects.toThrow(
      'Waited 40 ms for the app to connect. The app is not connected'
    );
  });
});

test('the note tells the app where to connect', () => {
  const container = mkdtempSync(join(tmpdir(), 'sovran-app-link-'));
  try {
    writeRunnerNote(container, { url: 'ws://127.0.0.1:41234', run: 'r1' });

    expect(readFileSync(join(container, 'Documents/e2e/runner.json'), 'utf8')).toBe(
      '{"url":"ws://127.0.0.1:41234","run":"r1"}'
    );
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});
