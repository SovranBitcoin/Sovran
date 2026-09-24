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
  caller?.addEventListener('abort', cancel, { once: true });
  if (caller?.aborted) cancel();
  touch(30_000);

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
