/**
 * @jest-environment node
 *
 * An uncaught throw used to reach Metro as a bare `ERROR  [TypeError: …]` with
 * no stack and never entered the ring buffer, so `log-doctor errors` could not
 * see it. These lock the two capture paths and the two properties that make the
 * capture safe to leave armed: the previous handlers still run, and secrets
 * never reach the log.
 */

import { armGlobalErrorCaptureForTest } from '@/shared/lib/loggerGlobalErrors';

const mockError = jest.fn();

jest.mock('@/shared/lib/loggerCore', () => ({
  SHOW_LOGS: true,
  log: { error: (event: string, params?: Record<string, unknown>) => mockError(event, params) },
  // The real redactor's contract is covered by loggerRedaction.test.ts; here it
  // only has to prove the capture routes text THROUGH a redactor.
  redactKnownSecretSubstrings: (value: string) => value.replace(/hunter2/g, '[redacted]'),
}));

type GlobalErrorUtils = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

describe('global error capture', () => {
  let disarm: (() => void) | null = null;
  let previousHandler: jest.Mock;
  let originalConsoleError: typeof console.error;
  let originalErrorUtils: GlobalErrorUtils | undefined;

  beforeEach(() => {
    mockError.mockClear();
    originalConsoleError = console.error;
    console.error = jest.fn();
    previousHandler = jest.fn();
    let handler: ((error: unknown, isFatal?: boolean) => void) | undefined = previousHandler;
    originalErrorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
    (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next) => {
        handler = next;
      },
    };
    disarm = armGlobalErrorCaptureForTest();
  });

  afterEach(() => {
    disarm?.();
    disarm = null;
    console.error = originalConsoleError;
    (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils = originalErrorUtils;
  });

  function fireGlobal(error: unknown, isFatal?: boolean): void {
    (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils!.getGlobalHandler!()!(
      error,
      isFatal
    );
  }

  it('logs an uncaught throw with its name, message and stack', () => {
    const error = new TypeError('property is not configurable');
    fireGlobal(error, true);

    const [event, params] = mockError.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('app.error.uncaught');
    expect(params).toMatchObject({
      errorName: 'TypeError',
      errorMessage: 'property is not configurable',
      isFatal: true,
    });
    expect((params.stack as string[]).length).toBeGreaterThan(0);
  });

  it('still calls the handler it replaced, so the red box survives', () => {
    const error = new Error('boom');
    fireGlobal(error, false);
    expect(previousHandler).toHaveBeenCalledWith(error, false);
  });

  it("captures React's reported render throw, which never reaches the global handler", () => {
    const error = new TypeError('property is not configurable');
    console.error(
      'The above error occurred in the <MintInfoScreen> component:',
      error,
      '\n    in MintInfoScreen\n    in Screen'
    );

    const [event, params] = mockError.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('app.error.react');
    expect(params).toMatchObject({ errorName: 'TypeError' });
    expect(params.componentStack).toContain('    in MintInfoScreen');
  });

  it('leaves ordinary console.error calls alone', () => {
    console.error('just a warning about something');
    expect(mockError).not.toHaveBeenCalled();
    expect(console.error).toBeDefined();
  });

  it('routes the message and the stack through the redactor', () => {
    const error = new Error('failed for hunter2');
    fireGlobal(error);
    const [, params] = mockError.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.errorMessage).toBe('failed for [redacted]');
    expect(JSON.stringify(params)).not.toContain('hunter2');
  });

  it('restores the original console.error when disarmed', () => {
    const armed = console.error;
    disarm?.();
    disarm = null;
    expect(console.error).not.toBe(armed);
    console.error('The above error occurred in the <X> component:', new Error('x'), 'stack');
    expect(mockError).not.toHaveBeenCalled();
  });
});
