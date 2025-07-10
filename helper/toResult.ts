import { ResultAsync, ok, err, Result } from 'neverthrow';

export const toResult = <T>(promise: Promise<T>) =>
  ResultAsync.fromPromise(promise, (e) => (e instanceof Error ? e : new Error(String(e))));

export const toResultSync = <T>(fn: () => T): Result<T, Error> => {
  try {
    return ok(fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};

