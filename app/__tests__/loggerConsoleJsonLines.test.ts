/**
 * `bun run dev` tees the Metro session to LOG.txt so it can be read back with
 * log-doctor. That only works while the console transport emits ONE JSON object
 * per line: the dev default is indented JSON, which spreads a single entry over
 * many lines and leaves the captured file unparseable (the reason a 19 MB
 * LOG.txt yielded nothing but `"event":` fragments).
 *
 * `EXPO_PUBLIC_LOG_PRETTY=0` is what `scripts/start-dev.sh` exports.
 */

const ORIGINAL = process.env.EXPO_PUBLIC_LOG_PRETTY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_LOG_PRETTY;
  else process.env.EXPO_PUBLIC_LOG_PRETTY = ORIGINAL;
  jest.resetModules();
});

function captureConsole(): string[] {
  const lines: string[] = [];
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  }
  return lines;
}

function logOnce(): string[] {
  jest.resetModules();
  const lines = captureConsole();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger } = require('@/shared/lib/logger');
    // No `transports` override: this is about the DEFAULT console transport.
    const log = createLogger({ level: 'debug', async: false });
    log.info('dev.capture.probe', { amount: 1, unit: 'sat' });
  });
  jest.restoreAllMocks();
  return lines;
}

describe('console transport capture format', () => {
  it('emits one parseable JSON object per line when pretty is off', () => {
    process.env.EXPO_PUBLIC_LOG_PRETTY = '0';
    const lines = logOnce();
    const entry = lines.find((line) => line.includes('dev.capture.probe'));
    expect(entry).toBeDefined();
    expect(entry).not.toContain('\n');
    expect(JSON.parse(entry!)).toMatchObject({
      event: 'dev.capture.probe',
      params: { amount: 1, unit: 'sat' },
    });
  });

  it('still indents when explicitly asked for a readable live window', () => {
    process.env.EXPO_PUBLIC_LOG_PRETTY = '1';
    const lines = logOnce();
    const entry = lines.find((line) => line.includes('dev.capture.probe'));
    expect(entry).toBeDefined();
    expect(entry).toContain('\n');
  });
});
