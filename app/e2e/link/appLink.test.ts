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
      if (type === 'elements')
        app.send(
          JSON.stringify({
            type: 'elements',
            id: JSON.parse(String(message.data)).id,
            appClockMs: clock,
            width: 402,
            height: 874,
            elements: [
              { id: 'wallet-send', page: 'WalletScreen', x: 16, y: 700, width: 180, height: 56 },
            ],
          })
        );
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

  test('asks the app whether its screen is still and waits for its answer', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);
    await link.connected(1000);
    const asked: number[] = [];
    socket.addEventListener('message', (message) => {
      const request = JSON.parse(String(message.data));
      if (request.type === 'still') asked.push(request.id);
    });

    const still = link.still(1000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    socket.send(JSON.stringify({ type: 'still', id: asked[0], appClockMs: 290, forced: false }));

    expect(await still).toEqual({ appClockMs: 290, forced: false });
  });

  test('says when the app never became still', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);
    await link.connected(1000);

    expect(link.still(40)).rejects.toThrow('Waited 40 ms for the app to say its screen is still.');
  });

  test('asks the app where its controls are', async () => {
    link = startAppLink();
    socket = await connectApp(link.url);
    await link.connected(1000);

    const [first, second] = await Promise.all([link.screen(), link.screen()]);

    expect(first).toEqual({
      appClockMs: 100,
      width: 402,
      height: 874,
      elements: [
        { id: 'wallet-send', page: 'WalletScreen', x: 16, y: 700, width: 180, height: 56 },
      ],
    });
    expect(second).toEqual(first);
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
