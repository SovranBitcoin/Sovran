/**
 * Lightweight timing helper for initialization diagnostics.
 *
 * Every call to `initLog(tag, msg)` prints:
 *   [Init +<ms>ms] <tag> — <msg>
 *
 * where <ms> is the wall-clock offset from APP_START_TIME (module load).
 */

const APP_START_TIME = Date.now();

export function initLog(tag: string, msg: string): void {
  const offset = Date.now() - APP_START_TIME;
  console.log(`[Init +${offset}ms] ${tag} — ${msg}`);
}
