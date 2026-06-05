/**
 * App-session epoch for the query cache's cold-start detection.
 *
 * A "cold start" is the first time a cache key is accessed in the current app
 * session. The epoch is a plain module value: it resets to 1 on every JS
 * runtime start (a cold app reopen) and on a profile switch (which goes through
 * a full app reload). Each cache store records the epoch at which a key was
 * last touched; a key whose touched-epoch differs from the current epoch is
 * treated as cold (network-first, no stale first paint).
 *
 * `bumpCacheEpoch` exists for any future non-reload profile-switch path so it
 * can force cold-start semantics for the new profile.
 */
let epoch = 1;

export function currentCacheEpoch(): number {
  return epoch;
}

export function bumpCacheEpoch(): void {
  epoch += 1;
}
