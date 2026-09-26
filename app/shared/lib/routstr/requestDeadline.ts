/**
 * How long a request may go with no response at all.
 *
 * Not a connect timeout. A node paid per request (`X-Cashu`) buffers the WHOLE
 * upstream answer — every streamed token — computes the cost, mints the
 * change, and only then sends a byte. The node itself puts no timeout on the
 * upstream. So the first byte arrives after the entire completion has been
 * generated, and a 2,000-token answer from a reasoning model is a minute or
 * more of silence that is not a fault.
 *
 * Aborting inside that window is worse than waiting: the SDK re-throws an
 * abort without reclaiming the token, the node finishes the request anyway
 * and writes the change to a refund row, and the sats sit there until a sweep
 * happens to ask. Every 425 "refund pending" in `app/log.txt` is a request
 * that was still running when the client gave up on it.
 */
export const RESPONSE_START_DEADLINE_MS = 120_000;

/** Silence allowed between chunks once a response has begun. */
export const RESPONSE_IDLE_DEADLINE_MS = 60_000;

/** Bound connection setup and idle time, without capping a progressing answer. */
export function createRequestDeadline(caller?: AbortSignal) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const cancel = () => controller.abort(caller?.reason ?? new Error('Request cancelled'));
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  };
  const touch = (milliseconds: number) => {
    clearTimeout(timer);
    if (disposed || controller.signal.aborted) return;
    timer = setTimeout(() => {
      const error = new Error('The AI provider stopped responding');
      error.name = 'TimeoutError';
      controller.abort(error);
    }, milliseconds);
  };
  controller.signal.addEventListener('abort', dispose, { once: true });
  caller?.addEventListener('abort', cancel, { once: true });
  if (caller?.aborted) cancel();
  touch(RESPONSE_START_DEADLINE_MS);

  return {
    signal: controller.signal,
    touch,
    dispose,
    wait<T>(work: Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const aborted = () => {
          cleanup();
          reject(controller.signal.reason);
        };
        const cleanup = () => controller.signal.removeEventListener('abort', aborted);
        controller.signal.addEventListener('abort', aborted, { once: true });
        work.then(
          (value) => {
            cleanup();
            resolve(value);
          },
          (error) => {
            cleanup();
            reject(error);
          }
        );
        if (controller.signal.aborted) aborted();
      });
    },
  };
}

export type RequestDeadline = ReturnType<typeof createRequestDeadline>;
