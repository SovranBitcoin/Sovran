/**
 * Read-lifecycle log taxonomy — `read.<surface>.<phase>`.
 *
 * One contract for every data arrival in the app, so log-doctor's `reads` mode
 * can report per surface: cache-hit rate, time-to-first-usable-data, fetches
 * issued while a fresh entry already existed, superseded writes, and blank
 * flashes (populated → skeleton → populated on the same key).
 *
 * The `readId` joins four layers of the same read:
 *   read.<surface>.*            this module (hook / screen)
 *   query_cache.run.*           the query cache store
 *   nostr.read.<surface>.*      the facade (nostr/src/facade/data-layer.ts)
 *   nostr.tier.*                the tier engines under it
 *
 * Never log a raw pubkey, mint URL, note id or query: cache keys embed all of
 * those, so they travel as `keyHash`. Phases `applied` and `render` fire on
 * TRANSITIONS only, never per render.
 */
import { log, monotonicNow } from '@/shared/lib/logger';
import type { NostrTier } from '@sovranbitcoin/schemas';

export const readLog = log.child({ module: 'read' });

/**
 * Closed set so log-doctor can group. Names match the facade's own
 * `nostr.read.<surface>` where a surface exists on both sides.
 */
export type ReadSurface =
  | 'feed'
  | 'thread'
  | 'notifications'
  | 'followers'
  | 'dmConversations'
  | 'dmThread'
  | 'profile'
  | 'profileFeed'
  | 'profiles'
  | 'profileStats'
  | 'searchProfiles'
  | 'searchMints'
  | 'searchPosts'
  | 'noteStats'
  | 'socialGraph'
  | 'discoverMints'
  | 'mintDetail'
  | 'mintReviews'
  | 'mintAudit'
  | 'mintChanges';

export type ReadMode = 'initial' | 'refresh' | 'revalidate' | 'loadMore';
export type ReadTrigger = 'mount' | 'focus' | 'key-change' | 'user' | 'poll' | 'prefetch';
/** What the read decided to do with the cache it found. */
export type ReadAction =
  'serve-fresh' | 'serve-stale-revalidate' | 'fetch' | 'join-inflight' | 'skip';
export type ReadStrategy = 'sequential' | 'aggregate' | 'session' | 'http';
export type ReadSource = 'cache' | 'network' | 'seed' | 'partial';
export type RenderPhase = 'skeleton' | 'populated' | 'empty' | 'error' | 'revalidating';

let seq = 0;

/** Short, non-secret, unique per JS session, e.g. `r1k2-feed`; the surface suffix keeps a bare id readable. */
export function newReadId(surface: ReadSurface | string): string {
  seq += 1;
  const t = (monotonicNow() | 0).toString(36);
  return `r${seq.toString(36)}${t.slice(-3)}-${surface}`;
}

/** FNV-1a 32-bit over the cache key — keys contain pubkeys/queries and must never be logged raw. */
export function readKeyHash(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `k_${h.toString(16).padStart(8, '0')}`;
}

interface ReadIdentity {
  readId: string;
  surface: ReadSurface;
  keyHash: string;
}

export interface ReadRequestParams extends ReadIdentity {
  mode: ReadMode;
  trigger: ReadTrigger;
  action: ReadAction;
  strategy: ReadStrategy;
  cached: boolean;
  stale: boolean;
  coldStart: boolean;
  gen: number;
}

export interface ReadDoneParams extends ReadIdentity {
  gen: number;
  durationMs: number;
  source: ReadSource;
  tier?: NostrTier;
  sources?: NostrTier[];
  count: number;
  empty: boolean;
  degraded: boolean;
  complete: boolean;
  attempts?: string[];
}

export interface ReadFailedParams extends ReadIdentity {
  gen: number;
  durationMs: number;
  errorType: string;
  /** Usable data stayed on screen despite the failure. */
  retained: boolean;
  attempts?: string[];
}

export interface ReadSupersededParams extends ReadIdentity {
  gen: number;
  byGen?: number;
  reason: 'newer-request' | 'clear' | 'scope-change' | 'abort' | 'unmount';
}

export interface ReadPartialParams extends ReadIdentity {
  /** Sources that have answered so far (tiers, or a named app-side source such as 'contacts'). */
  answered: readonly string[];
  pending: readonly NostrTier[];
  count: number;
  gate: 'minItems' | 'capMs' | 'allSettled' | 'seed' | 'partial';
}

export interface ReadMergedParams extends ReadIdentity {
  tier: NostrTier | ReadSource;
  added: number;
  updated: number;
  complete: boolean;
}

export interface ReadAppliedParams {
  readId: string | null;
  surface: ReadSurface;
  keyHash: string;
  source: ReadSource;
  count: number;
  /** A previous value was on screen and got replaced (vs first paint). */
  replaced: boolean;
  sinceRequestMs?: number;
}

export interface ReadRenderParams {
  readId: string | null;
  surface: ReadSurface;
  keyHash: string;
  phase: RenderPhase;
  from: RenderPhase | null;
  count: number;
  sinceRequestMs?: number;
}

/** Typed emitters so every call site spells the params the same way. */
export const readEvents = {
  request: (p: ReadRequestParams) => readLog.info(`read.${p.surface}.request`, { ...p }),
  done: (p: ReadDoneParams) => readLog.info(`read.${p.surface}.done`, { ...p }),
  failed: (p: ReadFailedParams) => readLog.warn(`read.${p.surface}.failed`, { ...p }),
  superseded: (p: ReadSupersededParams) => readLog.debug(`read.${p.surface}.superseded`, { ...p }),
  partial: (p: ReadPartialParams) => readLog.info(`read.${p.surface}.partial`, { ...p }),
  merged: (p: ReadMergedParams) => readLog.debug(`read.${p.surface}.merged`, { ...p }),
  applied: (p: ReadAppliedParams) => readLog.debug(`read.${p.surface}.applied`, { ...p }),
  render: (p: ReadRenderParams) => readLog.debug(`read.${p.surface}.render`, { ...p }),
};

/** Narrow an unknown failure to a loggable type name (never its message: that may carry user data). */
export function readErrorType(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error';
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { type?: unknown }).type === 'string'
  ) {
    return (error as { type: string }).type;
  }
  return typeof error;
}
