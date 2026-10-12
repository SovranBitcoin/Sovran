/**
 * Link from the end-to-end test build to its runner (ADR 0033).
 *
 * The on-device log file reaches the runner two seconds late, which is too slow
 * to pace a story by. In the test build the app also sends every entry, as it
 * is logged, to the runner on the same machine, and writes the runner's step
 * marks into its own log so each entry falls inside a step by the app's clock.
 *
 * - Test build only: inert unless bundled with `EXPO_PUBLIC_E2E_LOGS=1`.
 * - The runner says where it listens by leaving a note in the app's own
 *   folder before launch; without a note nothing connects.
 * - Loopback only. The note is refused unless it names this machine.
 * - Entries are the compacted, redacted ones every transport receives.
 * - The runner can also ask where the controls are (`e2e/elementMap.ts`),
 *   which replaces reading the simulator's accessibility tree.
 */
import { Platform } from 'react-native';
import { z } from 'zod';

import { readScreen } from './e2e/elementMap';
import { IS_E2E_LOG_BUILD, log, logClockMs, type LogEntry } from './loggerCore';

const NOTE_DIR = 'e2e';
const NOTE_FILE = 'runner.json';
/** Entries kept while the runner has not answered yet. */
const MAX_HELD_ENTRIES = 5000;

// This machine as the iPhone simulator and the Android emulator name it.
const RunnerNoteSchema = z.object({
  url: z.string().regex(/^ws:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2):\d{2,5}$/),
  run: z.string().min(1).max(120),
});
type RunnerNote = z.infer<typeof RunnerNoteSchema>;

const RequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mark'), step: z.string().min(1).max(200) }),
  z.object({ type: z.literal('elements'), id: z.number().int() }),
  z.object({ type: z.literal('still'), id: z.number().int() }),
]);

/** What the app does when the runner asks. */
export interface RunnerRequests {
  /** A step begins: write it into the log. */
  onMark: (step: string) => void;
  /** Where the controls are now; sent back as it is returned. */
  readScreen: () => unknown;
  /** Call back once the screen is still: at once if it already is. */
  whenStill: (reply: (report: SettleReport) => void) => void;
}

export function parseRunnerNote(text: string | null): RunnerNote | null {
  if (text === null) return null;
  try {
    const parsed = RunnerNoteSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The part of a WebSocket the link uses. */
export interface RunnerSocket {
  send(data: string): void;
  onopen: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

export function connectRunnerLink(
  note: RunnerNote,
  open: (url: string) => RunnerSocket,
  requests: RunnerRequests
): { transport: (entry: LogEntry) => void } {
  let held: LogEntry[] | null = [];
  let live = false;
  const socket = open(note.url);
  const send = (message: unknown) => {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The runner going away must never disturb the app under test.
    }
  };

  socket.onopen = () => {
    live = true;
    send({ type: 'hello', run: note.run, platform: Platform.OS, appClockMs: logClockMs() });
    for (const entry of held ?? []) send({ type: 'log', entry });
    held = null;
  };
  socket.onclose = () => {
    live = false;
    held = null;
  };
  socket.onmessage = (message) => {
    if (typeof message.data !== 'string') return;
    try {
      const request = RequestSchema.safeParse(JSON.parse(message.data));
      if (!request.success) return;
      const asked = request.data;
      if (asked.type === 'mark') requests.onMark(asked.step);
      else if (asked.type === 'elements')
        send({ type: 'elements', id: asked.id, ...(requests.readScreen() as object) });
      else requests.whenStill((report) => send({ type: 'still', id: asked.id, ...report }));
    } catch {
      // Not a message for the app.
    }
  };

  return {
    transport: (entry) => {
      if (live) send({ type: 'log', entry });
      else if (held && held.length < MAX_HELD_ENTRIES) held.push(entry);
    },
  };
}

/**
 * What a person would see change: pages, navigation, layout, the payment flow
 * and its toasts, and the runner's own step marks. Relays, mint polling and
 * cache writes go on for as long as the app runs and are not waited for.
 */
const ON_SCREEN =
  /^(e2e\.step|nav\.|screen\.|ui\.screen|ui\.touch|render\.|visual\.|machine\.|screenAction|payment\.step|toast\.)|\.shift\./;
/** Frames with nothing happening on screen before the app calls itself settled. */
const STILL_FRAMES = 2;
/** A page whose slide never reports its end is taken to have stopped after this long. */
const SLIDE_GIVE_UP_MS = 3000;

interface SettleReport {
  appClockMs: number;
  /** True when a slide was given up on rather than seen to end. */
  forced: boolean;
}

/**
 * Knows when the screen has stopped changing: no page is sliding and nothing on
 * screen was logged for two frames. The runner asks, and is answered at once if
 * the screen is already still, otherwise when it next is. The frame loop runs
 * only between something happening and stillness, so an idle app is left alone.
 */
export function createSettleWatch(io: {
  nextFrame: (callback: () => void) => void;
  now: () => number;
}): {
  note: (entry: LogEntry) => void;
  whenStill: (reply: (report: SettleReport) => void) => void;
} {
  let sliding = 0;
  let slidingSince = 0;
  let changed = false;
  let stillFrames = 0;
  let looping = false;
  let waiting: ((report: SettleReport) => void)[] = [];

  const frame = () => {
    const now = io.now();
    let forced = false;
    if (sliding > 0 && now - slidingSince >= SLIDE_GIVE_UP_MS) {
      sliding = 0;
      forced = true;
    }
    if (changed) {
      changed = false;
      stillFrames = 0;
    } else stillFrames += 1;
    if (sliding === 0 && (forced || stillFrames >= STILL_FRAMES)) {
      looping = false;
      const asked = waiting;
      waiting = [];
      for (const reply of asked) reply({ appClockMs: now, forced });
      return;
    }
    io.nextFrame(frame);
  };

  return {
    note(entry) {
      if (!ON_SCREEN.test(entry.event)) return;
      if (entry.event === 'nav.transition.start') {
        sliding += 1;
        slidingSince = io.now();
      } else if (entry.event === 'nav.transition.end') sliding = Math.max(0, sliding - 1);
      changed = true;
      if (looping) return;
      looping = true;
      stillFrames = 0;
      io.nextFrame(frame);
    },
    whenStill(reply) {
      if (looping) waiting.push(reply);
      else reply({ appClockMs: io.now(), forced: false });
    },
  };
}

function readRunnerNote(): string | null {
  try {
    const fs = require('expo-file-system') as typeof import('expo-file-system');
    const file = new fs.File(new fs.Directory(fs.Paths.document, NOTE_DIR), NOTE_FILE);
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

if (IS_E2E_LOG_BUILD && Platform.OS !== 'web') {
  const note = parseRunnerNote(readRunnerNote());
  if (note) {
    const settle = createSettleWatch({
      nextFrame: (callback) => requestAnimationFrame(callback),
      now: logClockMs,
    });
    const link = connectRunnerLink(note, (url) => new WebSocket(url) as unknown as RunnerSocket, {
      onMark: (step) => log.info('e2e.step', { step }),
      readScreen: () => ({ appClockMs: logClockMs(), ...readScreen() }),
      whenStill: settle.whenStill,
    });
    log.addTransport(link.transport);
    log.addTransport(settle.note);
  }
}
