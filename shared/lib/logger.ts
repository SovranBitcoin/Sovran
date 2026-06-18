/**
 * Public barrel for the Sovran logger.
 *
 * The logger split lives in sibling files so each concern is its own deep
 * module behind a small interface (audit 56 F-004):
 *
 *   loggerCore.ts    — types, RingBuffer, createLogger, log, child loggers,
 *                      init helpers, redactError
 *   loggerJsThread   — JS-thread heartbeat monitor (auto-arms on import)
 *   loggerDefer      — InteractionManager-aware scheduler
 *   loggerHooks      — useRenderLogger / useLifecycleLogger
 *   loggerUI         — <Log> JSX component + UIPath context
 *
 * Importing this barrel arms the JS-thread monitor as a side effect; the
 * monitor is gated to __DEV__ inside loggerJsThread, so production builds
 * still skip the heartbeat.
 */

// Side-effect import: must run on barrel load so the dev heartbeat starts.
import './loggerJsThread';

export type { Logger, RedactedError } from './loggerCore';

export {
  createLogger,
  monotonicNow,
  log,
  initLog,
  initPhase,
  initPhaseSync,
  useInitMount,
  redactError,
  nfcLog,
  cashuLog,
  nostrLog,
  walletLog,
  paymentLog,
  feedLog,
  apiLog,
  storeLog,
  aiLog,
  chatLog,
  bitchatLog,
  wnLog,
  popupLog,
  mapLog,
} from './loggerCore';

export { applyFileLogging, exportLogFile, clearLogFile, getLogFileInfo } from './loggerFile';
export type { LogFileInfo } from './loggerFile';

export { stopJSThreadMonitor } from './loggerJsThread';
export { deferWork } from './loggerDefer';
export { useRenderLogger, useLifecycleLogger } from './loggerHooks';
export { Log } from './loggerUI';
