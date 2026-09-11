export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestControls {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  const sources = [...new Set(signals.filter((signal): signal is AbortSignal => !!signal))];
  const aborted = sources.find((signal) => signal.aborted);
  if (aborted) {
    controller.abort(aborted.reason);
    return controller.signal;
  }
  const listeners = new Map<AbortSignal, () => void>();
  for (const signal of sources) {
    const onAbort = () => {
      // A deadline must release its listener on the longer-lived caller too.
      for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
      listeners.clear();
      controller.abort(signal.reason);
    };
    listeners.set(signal, onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => {
    const error = new Error('Timed out');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, ms);
  return controller.signal;
}

export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
