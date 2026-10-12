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
  }
}
