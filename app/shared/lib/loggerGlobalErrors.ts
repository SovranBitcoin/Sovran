// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL ERROR CAPTURE — give uncaught failures a stack in the structured log
// ═══════════════════════════════════════════════════════════════════════════════
//
// Nothing in the app captured uncaught errors, so a throw reached Metro as a
// bare `ERROR  [TypeError: property is not configurable]` with no stack, no
// screen, and no route — and never entered the ring buffer, so log-doctor's
// `errors` mode could not see it either. Diagnosing one meant guessing.
//
// Two sources, because they are genuinely different:
//
//   ErrorUtils.setGlobalHandler  an uncaught throw on the JS thread. The
//                                previous handler is CHAINED, so the dev red
//                                box and the release crash reporter still fire.
//   console.error                React reports a render/effect throw here (with
//                                its component stack) after an error boundary —
//                                or LogBox — has already swallowed it, so the
//                                global handler never sees it. This is the path
//                                that produced the bare TypeError above.
//
// Dev-only: armed at module load behind `SHOW_LOGS`, and skipped under Jest so
// a suite that asserts on `console.error` still sees its own calls untouched.

import { log, redactKnownSecretSubstrings, SHOW_LOGS } from './loggerCore';

/** Frames are paths and function names, but a bundled frame can inline a literal — redact anyway. */
const MAX_STACK_FRAMES = 12;

function redactedStack(error: unknown): string[] {
  const stack = error instanceof Error ? error.stack : undefined;
  if (typeof stack !== 'string') return [];
  return stack
    .split('\n')
    .slice(1, MAX_STACK_FRAMES + 1)
    .map((frame) => redactKnownSecretSubstrings(frame.trim()));
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error';
  return typeof error;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return redactKnownSecretSubstrings(error.message);
  if (typeof error === 'string') return redactKnownSecretSubstrings(error);
  return '';
}

// A logger transport that itself throws (or console.errors) would otherwise
// re-enter this handler forever.
let reporting = false;

function report(event: string, error: unknown, extra: Record<string, unknown>): void {
  if (reporting) return;
  reporting = true;
  try {
    log.error(event, {
      errorName: errorName(error),
      errorMessage: errorMessage(error),
      stack: redactedStack(error),
      ...extra,
    });
  } catch {
    // Reporting must never be the thing that takes the app down.
  } finally {
    reporting = false;
  }
}

type GlobalErrorUtils = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

/** React's own report reads `Warning:`/`The above error…`; only the latter carries a real throw. */
function consoleArgsLookLikeReactError(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === 'string' && first.includes('The above error occurred');
}

function firstErrorArg(args: unknown[]): unknown {
  for (const arg of args) if (arg instanceof Error) return arg;
  return args[0];
}

function armGlobalErrorCapture(): () => void {
  const errorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();
  if (errorUtils?.setGlobalHandler) {
    errorUtils.setGlobalHandler((error, isFatal) => {
      report('app.error.uncaught', error, { isFatal: !!isFatal });
      // Chain: the red box and any native reporter are still the owners of
      // what the user and the crash pipeline see.
      previousHandler?.(error, isFatal);
    });
  }

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (consoleArgsLookLikeReactError(args)) {
      const error = firstErrorArg(args);
      report('app.error.react', error, {
        // React puts the component stack in the trailing argument; it names
        // components only, which is exactly the context a bare TypeError lacks.
        componentStack:
          typeof args[args.length - 1] === 'string'
            ? redactKnownSecretSubstrings(String(args[args.length - 1]))
                .split('\n')
                .slice(0, 12)
            : [],
      });
    }
    originalConsoleError(...args);
  };

  return () => {
    console.error = originalConsoleError;
    if (previousHandler && errorUtils?.setGlobalHandler) {
      errorUtils.setGlobalHandler(previousHandler);
    }
  };
}

const IS_JEST_RUNTIME = typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined;

if (SHOW_LOGS && !IS_JEST_RUNTIME) {
  // Armed for the life of the process: there is no point at which the app
  // would rather an uncaught error went unrecorded, so no disarm is exported.
  armGlobalErrorCapture();
}

/** The live arming path, for a test that wants it without the module-load gate. */
export const armGlobalErrorCaptureForTest = armGlobalErrorCapture;
