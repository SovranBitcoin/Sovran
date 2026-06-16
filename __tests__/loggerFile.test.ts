/**
 * On-device log file transport (shared/lib/loggerFile).
 *
 * Protects the contract log-doctor depends on: when file logging is enabled,
 * every entry is appended as compact NDJSON (one JSON object per line). Also
 * guards the opt-in gate, export concatenation, and clear.
 */
/* eslint-disable import/first */

// In-memory expo-file-system so the transport's sync write/append/rotate path
// runs without touching a real device FS. The store is exposed as `__store`.
jest.mock('expo-file-system', () => {
  const store = new Map<string, string>();
  const toUri = (parts: (string | { uri: string })[]): string =>
    parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');

  class FakeDirectory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = toUri(parts);
    }
    get exists(): boolean {
      return true;
    }
    create(): void {}
  }

  class FakeFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = toUri(parts);
    }
    get exists(): boolean {
      return store.has(this.uri);
    }
    get size(): number {
      return store.has(this.uri) ? Buffer.byteLength(store.get(this.uri) ?? '') : 0;
    }
    create(): void {
      if (!store.has(this.uri)) store.set(this.uri, '');
    }
    write(content: string, options?: { append?: boolean }): void {
      const prev = options?.append ? (store.get(this.uri) ?? '') : '';
      store.set(this.uri, prev + content);
    }
    textSync(): string {
      return store.get(this.uri) ?? '';
    }
    delete(): void {
      store.delete(this.uri);
    }
    move(dest: { uri: string }): void {
      const content = store.get(this.uri) ?? '';
      store.delete(this.uri);
      store.set(dest.uri, content);
      this.uri = dest.uri;
    }
  }

  return {
    __store: store,
    Paths: { document: { uri: 'doc' }, cache: { uri: 'cache' } },
    Directory: FakeDirectory,
    File: FakeFile,
  };
});

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

import {
  log,
  applyFileLogging,
  exportLogFile,
  clearLogFile,
  getLogFileInfo,
} from '@/shared/lib/logger';
import * as FS from 'expo-file-system';
import { Platform } from 'react-native';

const store = (FS as unknown as { __store: Map<string, string> }).__store;
const ACTIVE = 'doc/sovran-logs/log.txt';
const PREV = 'doc/sovran-logs/log.prev.txt';
const EXPORT = 'cache/sovran-log-export.txt';

// Async transports flush via queueMicrotask; drain them before asserting.
const drainMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

// jest-expo/node reports Platform.OS as 'web', which the transport skips by
// design. Pin it to a native platform so the file path is exercised.
beforeAll(() => {
  (Platform as { OS: string }).OS = 'ios';
});

beforeEach(() => {
  applyFileLogging(false);
  clearLogFile();
  store.clear();
});

afterEach(() => {
  applyFileLogging(false);
  clearLogFile();
});

describe('loggerFile transport', () => {
  it('appends each entry as one NDJSON line when enabled', async () => {
    applyFileLogging(true);
    log.info('test.file.alpha', { a: 1 });
    log.info('test.file.beta', { b: 2 });
    await drainMicrotasks();
    applyFileLogging(false); // disabling flushes the buffer to disk

    const content = store.get(ACTIVE) ?? '';
    const lines = content.split('\n').filter(Boolean);
    const parsed = lines.map((line) => JSON.parse(line));
    // Every line is independently valid JSON with the log-doctor shape.
    expect(parsed.every((e) => e.event && e.level)).toBe(true);
    expect(parsed.map((e) => e.event)).toEqual(
      expect.arrayContaining(['test.file.alpha', 'test.file.beta'])
    );
  });

  it('writes nothing while the toggle is off', async () => {
    log.info('test.file.ignored', { skip: true });
    await drainMicrotasks();
    expect(store.get(ACTIVE)).toBeUndefined();
  });

  it('clearLogFile removes the on-device file', async () => {
    applyFileLogging(true);
    log.info('test.file.gamma', {});
    await drainMicrotasks();
    applyFileLogging(false);
    expect(getLogFileInfo().exists).toBe(true);

    clearLogFile();
    expect(getLogFileInfo().exists).toBe(false);
  });

  it('export concatenates previous + active generations in order', async () => {
    store.set(PREV, '{"event":"old","level":"info"}\n');
    store.set(ACTIVE, '{"event":"new","level":"info"}\n');

    const shared = await exportLogFile();
    expect(shared).toBe(true);

    const exported = store.get(EXPORT) ?? '';
    const events = exported
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).event);
    expect(events).toEqual(['old', 'new']);
  });

  it('export returns false when there is no log file', async () => {
    expect(await exportLogFile()).toBe(false);
  });
});
