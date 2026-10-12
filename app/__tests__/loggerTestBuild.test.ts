/**
 * Logging in a build that is not a development build.
 *
 * A store build logs nothing. The end-to-end test build has no bundler to
 * print to, so it turns logging on with `EXPO_PUBLIC_E2E_LOGS=1` and writes
 * every entry to the on-device file from the first line, where the runner
 * reads it.
 */

type Logger = typeof import('@/shared/lib/logger');

const ACTIVE = 'doc/sovran-logs/log.txt';

function loadLogger(e2eLogs: string | undefined): { logger: Logger; files: Map<string, string> } {
  const files = new Map<string, string>();
  jest.resetModules();
  const uriOf = (parts: (string | { uri: string })[]) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  jest.doMock('expo-file-system', () => ({
    Paths: { document: { uri: 'doc' }, cache: { uri: 'cache' } },
    Directory: class {
      uri: string;
      exists = true;
      constructor(...parts: (string | { uri: string })[]) {
        this.uri = uriOf(parts);
      }
      create() {}
    },
    File: class {
      uri: string;
      constructor(...parts: (string | { uri: string })[]) {
        this.uri = uriOf(parts);
      }
      get exists() {
        return files.has(this.uri);
      }
      get size() {
        return (files.get(this.uri) ?? '').length;
      }
      create() {
        if (!files.has(this.uri)) files.set(this.uri, '');
      }
      write(content: string, options?: { append?: boolean }) {
        files.set(this.uri, (options?.append ? (files.get(this.uri) ?? '') : '') + content);
      }
      textSync() {
        return files.get(this.uri) ?? '';
      }
      delete() {
        files.delete(this.uri);
      }
    },
  }));
  jest.doMock('expo-sharing', () => ({
    isAvailableAsync: async () => false,
    shareAsync: async () => {},
  }));
  // jest-expo/node reports 'web', which the file transport skips by design.
  // Babel rewrites `import { Platform } from 'react-native'` to this module.
  (require('react-native-web/dist/exports/Platform') as { default: { OS: string } }).default.OS =
    'ios';
  if (e2eLogs === undefined) delete process.env.EXPO_PUBLIC_E2E_LOGS;
  else process.env.EXPO_PUBLIC_E2E_LOGS = e2eLogs;
  const globals = globalThis as { __DEV__?: boolean };
  const wasDev = globals.__DEV__;
  globals.__DEV__ = false;
  try {
    return { logger: require('@/shared/lib/logger') as Logger, files };
  } finally {
    globals.__DEV__ = wasDev;
  }
}

// Transports are handed each entry on a microtask.
const drainMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const eventsIn = (text: string | undefined) =>
  (text ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { event: string }).event);

describe('logging outside a development build', () => {
  const hadFlag = process.env.EXPO_PUBLIC_E2E_LOGS;

  afterEach(() => {
    if (hadFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_LOGS;
    else process.env.EXPO_PUBLIC_E2E_LOGS = hadFlag;
  });

  it('a store build logs nothing and writes no file', async () => {
    const { logger, files } = loadLogger(undefined);

    logger.applyFileLogging(true);
    logger.log.info('test.store_build.entry', { n: 1 });
    await drainMicrotasks();
    await logger.exportLogFile();

    expect(logger.SHOW_LOGS).toBe(false);
    expect(files.size).toBe(0);
  });

  it('the test build writes every entry to the file without being asked', async () => {
    const { logger, files } = loadLogger('1');

    logger.log.info('test.e2e_build.first', { n: 1 });
    await drainMicrotasks();
    await logger.exportLogFile();

    expect(logger.SHOW_LOGS).toBe(true);
    expect(eventsIn(files.get(ACTIVE))).toContain('test.e2e_build.first');
  });

  it('the saved setting being off does not stop the test build writing', async () => {
    const { logger, files } = loadLogger('1');

    logger.applyFileLogging(false);
    logger.log.info('test.e2e_build.after_settings_loaded', { n: 2 });
    await drainMicrotasks();
    await logger.exportLogFile();

    expect(eventsIn(files.get(ACTIVE))).toContain('test.e2e_build.after_settings_loaded');
  });
});
