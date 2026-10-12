/**
 * The runner's end of the link to the end-to-end test build (ADR 0033).
 *
 * The app under test connects here at launch and sends each log entry as it
 * happens (`shared/lib/loggerRunnerLink.ts`). A story waits on those entries,
 * never on a duration, and marks its steps into the app's own log so that every
 * entry can be placed in a step by the app's clock.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A log entry as the app sends it. Only the fields a runner waits on are named. */
export interface AppLogEntry {
  _t: number;
  level: string;
  event: string;
  params?: Record<string, unknown>;
  [field: string]: unknown;
}

export interface AppHello {
  run: string;
  platform: string;
  appClockMs: number;
}

/** The app saying its screen has stopped changing. */
export interface AppSettled {
  appClockMs: number;
  /** True when the app gave up on a page slide that never reported its end. */
  forced: boolean;
}

/** A control as the app reports it: laid-out frame in points, tree order. */
interface AppElement {
  id?: string;
  label?: string;
  value?: string;
  text?: string;
  disabled?: true;
  /** `name` of the `Screen` the element is on. */
  page?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppScreen {
  appClockMs: number;
  /** Window size in points; an element's frame is in the same units. */
  width: number;
  height: number;
  elements: AppElement[];
  /** Where the map came from, which explains an empty one. */
  source?: string;
}

export interface AppLink {
  /** Where the app is told to connect, as the iPhone simulator names this machine. */
  readonly url: string;
  /** Every entry received, in arrival order. */
  readonly entries: readonly AppLogEntry[];
  /** Resolves when the app has connected. */
  connected(timeoutMs: number): Promise<AppHello>;
  /** Write a step boundary into the app's log; returns once the app has logged it. */
  mark(step: string, timeoutMs?: number): Promise<AppLogEntry>;
  /**
   * The first entry at or after `from` (an index into `entries`) that matches.
   * Rejects at the deadline, naming what the app logged last.
   */
  waitFor(
    matches: (entry: AppLogEntry) => boolean,
    options: { timeoutMs: number; from?: number; what: string }
  ): Promise<AppLogEntry>;
  /**
   * Ask the app whether its screen is still. It answers at once if so, otherwise
   * when it next is: no page sliding, nothing on screen logged for two frames.
   */
  still(timeoutMs: number): Promise<AppSettled>;
  /** Where the app's controls are now, from the app's own tree. */
  screen(timeoutMs?: number): Promise<AppScreen>;
  close(): void;
}

/** Tell the app where its runner listens, before launch. `containerDir` is the app's data folder. */
export function writeRunnerNote(containerDir: string, note: { url: string; run: string }): void {
  const dir = join(containerDir, 'Documents', 'e2e');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'runner.json');
  writeFileSync(`${path}.tmp`, JSON.stringify(note));
  renameSync(`${path}.tmp`, path);
}

export function startAppLink(): AppLink {
  const entries: AppLogEntry[] = [];
  const stills = new Map<number, AppSettled>();
  const screens = new Map<number, AppScreen>();
  let nextRequest = 1;
  const watchers = new Set<() => void>();
  let hello: AppHello | null = null;
  let app: { send(data: string): unknown } | null = null;
  const changed = () => {
    for (const watcher of [...watchers]) watcher();
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, bunServer) {
      return bunServer.upgrade(request) ? undefined : new Response('app link', { status: 426 });
    },
    websocket: {
      open(socket) {
        app = socket;
      },
      close() {
        app = null;
      },
      message(_socket, data) {
        if (typeof data !== 'string') return;
        let message: { type?: unknown; entry?: unknown; forced?: unknown; id?: unknown } & Partial<
          AppHello & AppScreen
        >;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (message.type === 'hello' && typeof message.run === 'string') {
          hello = {
            run: message.run,
            platform: String(message.platform),
            appClockMs: Number(message.appClockMs),
          };
        } else if (message.type === 'log' && isEntry(message.entry)) {
          entries.push(message.entry);
        } else if (
          message.type === 'still' &&
          typeof message.id === 'number' &&
          typeof message.appClockMs === 'number'
        ) {
          stills.set(message.id, {
            appClockMs: message.appClockMs,
            forced: message.forced === true,
          });
        } else if (
          message.type === 'elements' &&
          typeof message.id === 'number' &&
          Array.isArray(message.elements)
        ) {
          screens.set(message.id, {
            appClockMs: Number(message.appClockMs),
            width: Number(message.width),
            height: Number(message.height),
            elements: message.elements,
            ...(typeof message.source === 'string' ? { source: message.source } : {}),
          });
        } else return;
        changed();
      },
    },
  });

  /** Resolve with the first non-null `read()`, re-reading whenever something arrives. */
  function until<T>(read: () => T | null, timeoutMs: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const value = read();
        if (value === null) return;
        clearTimeout(timer);
        watchers.delete(check);
        resolve(value);
      };
      const timer = setTimeout(() => {
        watchers.delete(check);
        const last = entries
          .slice(-5)
          .map((entry) => entry.event)
          .join(', ');
        reject(
          new Error(
            `Waited ${timeoutMs} ms for ${what}. ${app ? `The app last logged: ${last || 'nothing'}` : 'The app is not connected'}`
          )
        );
      }, timeoutMs);
      watchers.add(check);
      check();
    });
  }

  const waitFor: AppLink['waitFor'] = (matches, { timeoutMs, from = 0, what }) => {
    let next = from;
    return until(
      () => {
        for (; next < entries.length; next++) if (matches(entries[next])) return entries[next];
        return null;
      },
      timeoutMs,
      what
    );
  };

  return {
    url: `ws://127.0.0.1:${server.port}`,
    entries,
    connected: (timeoutMs) => until(() => hello, timeoutMs, 'the app to connect'),
    mark(step, timeoutMs = 5000) {
      const from = entries.length;
      if (!app) return Promise.reject(new Error(`Cannot mark ${step}: the app is not connected`));
      app.send(JSON.stringify({ type: 'mark', step }));
      return waitFor((entry) => entry.event === 'e2e.step' && entry.params?.step === step, {
        timeoutMs,
        from,
        what: `the app to log step ${step}`,
      });
    },
    waitFor,
    still(timeoutMs) {
      if (!app) return Promise.reject(new Error('Cannot ask the app: it is not connected'));
      const id = nextRequest++;
      app.send(JSON.stringify({ type: 'still', id }));
      return until(
        () => {
          const answer = stills.get(id) ?? null;
          if (answer) stills.delete(id);
          return answer;
        },
        timeoutMs,
        'the app to say its screen is still'
      );
    },
    screen(timeoutMs = 2000) {
      if (!app)
        return Promise.reject(new Error('Cannot read the screen: the app is not connected'));
      const id = nextRequest++;
      app.send(JSON.stringify({ type: 'elements', id }));
      return until(
        () => {
          const screen = screens.get(id) ?? null;
          if (screen) screens.delete(id);
          return screen;
        },
        timeoutMs,
        'the app to say where its controls are'
      );
    },
    close() {
      void server.stop(true);
    },
  };
}

function isEntry(value: unknown): value is AppLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.event === 'string' &&
    typeof entry.level === 'string' &&
    typeof entry._t === 'number'
  );
}
