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
 */
import { Platform } from 'react-native';
import { z } from 'zod';

import { IS_E2E_LOG_BUILD, log, monotonicNow, type LogEntry } from './loggerCore';

const NOTE_DIR = 'e2e';
const NOTE_FILE = 'runner.json';
/** Entries kept while the runner has not answered yet. */
const MAX_HELD_ENTRIES = 5000;

// This machine as the iPhone simulator and the Android emulator name it.
const RunnerNoteSchema = z.object({
  url: z.string().regex(/^ws:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2):\d{2,5}$/),
  run: z.string().min(1).max(120),
});
export type RunnerNote = z.infer<typeof RunnerNoteSchema>;

const MarkSchema = z.object({ type: z.literal('mark'), step: z.string().min(1).max(200) });

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
  onMark: (step: string) => void
): { transport: (entry: LogEntry) => void; send: (message: unknown) => void } {
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
    send({ type: 'hello', run: note.run, platform: Platform.OS, appClockMs: monotonicNow() });
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
      const mark = MarkSchema.safeParse(JSON.parse(message.data));
      if (mark.success) onMark(mark.data.step);
    } catch {
      // Not a message for the app.
    }
  };

  return {
    transport: (entry) => {
      if (live) send({ type: 'log', entry });
      else if (held && held.length < MAX_HELD_ENTRIES) held.push(entry);
    },
    send: (message) => {
      if (live) send(message);
    },
  };
}

/**
 * What a person would see change: pages, navigation, layout, the payment flow
 * and its toasts, and the runner's own step marks. Relays, mint polling and
 * cache writes go on for as long as the app runs and are not waited for.
 */
const ON_SCREEN =
  /^(e2e\.step|nav\.|screen\.|ui\.screen|render\.|visual\.|machine\.|screenAction|payment\.step|toast\.)|\.shift\./;
/** Frames with nothing happening on screen before the app calls itself settled. */
const STILL_FRAMES = 2;
/** A page whose slide never reports its end is taken to have stopped after this long. */
const SLIDE_GIVE_UP_MS = 3000;

export interface SettleReport {
  appClockMs: number;
  /** True when a slide was given up on rather than seen to end. */
  forced: boolean;
}

/**
 * Tells the runner when the screen has stopped changing: no page is sliding and
 * nothing on screen was logged for two frames. The frame loop runs only between
 * something happening and the report, so an idle app is left alone.
 */
export function createSettleWatch(io: {
  nextFrame: (callback: () => void) => void;
  now: () => number;
  onSettled: (report: SettleReport) => void;
}): { note: (entry: LogEntry) => void } {
  let sliding = 0;
  let slidingSince = 0;
  let changed = false;
  let stillFrames = 0;
  let looping = false;

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
      io.onSettled({ appClockMs: now, forced });
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
    const link = connectRunnerLink(
      note,
      (url) => new WebSocket(url) as unknown as RunnerSocket,
      (step) => log.info('e2e.step', { step })
    );
    log.addTransport(link.transport);
    const settle = createSettleWatch({
      nextFrame: (callback) => requestAnimationFrame(callback),
      now: monotonicNow,
      onSettled: (report) => link.send({ type: 'settled', ...report }),
    });
    log.addTransport(settle.note);
  }
}
