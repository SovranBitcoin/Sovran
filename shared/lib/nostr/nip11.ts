/**
 * @fileoverview NIP-11 relay information document fetch + cache.
 *
 * A relay advertises metadata (name, software, supported NIPs, posting limits)
 * at its HTTP origin with `Accept: application/nostr+json`. Used by the relay
 * settings screen (display) and the composer's Nostr capability descriptor
 * (the `limitation.max_content_length` ceiling). Cached per host with a TTL so
 * opening the composer never blocks on a slow relay.
 */
import { ResultAsync } from 'neverthrow';

import { nostrLog } from '@/shared/lib/logger';

export interface RelayLimitation {
  max_content_length?: number;
  max_message_length?: number;
  max_subscriptions?: number;
  auth_required?: boolean;
  payment_required?: boolean;
}

export interface RelayInformation {
  name?: string;
  description?: string;
  software?: string;
  version?: string;
  supported_nips?: number[];
  icon?: string;
  limitation?: RelayLimitation;
}

export type RelayInfoError = { type: 'fetch-failed' } | { type: 'invalid' };

const TTL_MS = 60 * 60 * 1000; // 1h
const FETCH_TIMEOUT_MS = 6_000;
const EMPTY_INFO: RelayInformation = {};

interface CacheEntry {
  info: RelayInformation;
  at: number;
}
const cache = new Map<string, CacheEntry>();

/** `wss://relay.example/` → `https://relay.example/`. */
function toHttpUrl(relayUrl: string): string {
  return relayUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
}

function parseInfo(raw: unknown): RelayInformation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const info: RelayInformation = {};
  if (typeof obj.name === 'string') info.name = obj.name;
  if (typeof obj.description === 'string') info.description = obj.description;
  if (typeof obj.software === 'string') info.software = obj.software;
  if (typeof obj.version === 'string') info.version = obj.version;
  if (typeof obj.icon === 'string') info.icon = obj.icon;
  if (Array.isArray(obj.supported_nips)) {
    info.supported_nips = obj.supported_nips.filter((n): n is number => typeof n === 'number');
  }
  if (typeof obj.limitation === 'object' && obj.limitation !== null) {
    const lim = obj.limitation as Record<string, unknown>;
    info.limitation = {
      max_content_length:
        typeof lim.max_content_length === 'number' ? lim.max_content_length : undefined,
      max_message_length:
        typeof lim.max_message_length === 'number' ? lim.max_message_length : undefined,
      auth_required: typeof lim.auth_required === 'boolean' ? lim.auth_required : undefined,
      payment_required:
        typeof lim.payment_required === 'boolean' ? lim.payment_required : undefined,
    };
  }
  return info;
}

/** Fetches (and caches) a relay's NIP-11 document. */
export function fetchRelayInformation(
  relayUrl: string
): ResultAsync<RelayInformation, RelayInfoError> {
  const cached = cache.get(relayUrl);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return ResultAsync.fromSafePromise(Promise.resolve(cached.info));
  }

  return ResultAsync.fromPromise(
    (async (): Promise<RelayInformation> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // NIP-11 docs use a custom `application/nostr+json` content type and no
        // zod envelope, so apiClient's fetchJson doesn't fit — raw fetch with an
        // explicit AbortController timeout is the sanctioned exception here.
        // eslint-disable-next-line no-restricted-globals
        const res = await fetch(toHttpUrl(relayUrl), {
          headers: { Accept: 'application/nostr+json' },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const info = parseInfo(await res.json());
        if (!info) throw new Error('invalid nip-11 document');
        cache.set(relayUrl, { info, at: Date.now() });
        return info;
      } finally {
        clearTimeout(timer);
      }
    })(),
    (): RelayInfoError => {
      nostrLog.warn('nostr.nip11.fetch_failed', { host: toHttpUrl(relayUrl) });
      return { type: 'fetch-failed' };
    }
  );
}

/**
 * The tightest `max_content_length` across the given relays (the composer must
 * respect the strictest write relay). Returns `undefined` when no relay
 * advertises a limit, so callers apply a sane default.
 */
export async function getMergedContentLimit(
  relayUrls: readonly string[]
): Promise<number | undefined> {
  const infos = await Promise.all(
    relayUrls.map((url) => fetchRelayInformation(url).unwrapOr(EMPTY_INFO))
  );
  let min: number | undefined;
  for (const info of infos) {
    const limit = info.limitation?.max_content_length;
    if (typeof limit === 'number' && limit > 0)
      min = min === undefined ? limit : Math.min(min, limit);
  }
  return min;
}
