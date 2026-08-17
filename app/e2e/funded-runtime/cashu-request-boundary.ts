import { setGlobalRequestOptions } from '@cashu/cashu-ts';

interface BoundedCashuRequestOptions {
  /** Total wall-clock budget shared by every Cashu request in the operation. */
  readonly deadlineMs: number;
  /** Per-request guard so one connection cannot consume the whole budget. */
  readonly requestTimeoutMs: number;
}

let activeBoundary = false;

function assertDuration(value: number, context: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${context}`);
}

/**
 * cashu-ts exposes request cancellation through process-global request options.
 * Startup recovery is deliberately serial, so this boundary installs one
 * shared abort signal for the operation and always restores the package
 * defaults before returning. The signal cancels the underlying fetch; this is
 * not a Promise.race that could leave seed recovery running in the background.
 */
export async function withBoundedCashuRequests<T>(
  options: BoundedCashuRequestOptions,
  operation: () => Promise<T>
): Promise<T> {
  assertDuration(options.deadlineMs, 'Cashu recovery deadline');
  assertDuration(options.requestTimeoutMs, 'Cashu request timeout');
  if (activeBoundary) throw new Error('Cashu recovery request boundary is already active');

  activeBoundary = true;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.deadlineMs);
  setGlobalRequestOptions({
    requestTimeout: options.requestTimeoutMs,
    signal: abort.signal,
  });
  try {
    return await operation();
  } finally {
    clearTimeout(timer);
    abort.abort();
    setGlobalRequestOptions({});
    activeBoundary = false;
  }
}
