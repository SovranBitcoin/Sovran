/**
 * @fileoverview NIP-11 relay information document fetcher.
 *
 * A relay advertises metadata (name, software, supported NIPs, posting limits)
 * at its HTTP origin with `Accept: application/nostr+json`. This module is the
 * pure network fetcher + document schema; the single cache (persisted SWR)
 * lives in `relayMetadataStore` — consumers go through `getCachedRelayInfo` /
 * `useRelayMetadata` there, never call this directly from UI.
 */
import { ResultAsync } from 'neverthrow';
import { z } from 'zod';

import { nostrLog } from '@/shared/lib/logger';

// Tolerant per the persisted-schema invariant: the parsed document is stored
// verbatim in `relayMetadataStore`, so every field is `.optional().catch()` —
// one malformed field drops that field, never the whole document (and never,
// on rehydrate, the whole store).
const RelayLimitationSchema = z.looseObject({
  max_content_length: z.number().optional().catch(undefined),
  max_message_length: z.number().optional().catch(undefined),
  max_subscriptions: z.number().optional().catch(undefined),
  max_filters: z.number().optional().catch(undefined),
  max_limit: z.number().optional().catch(undefined),
  auth_required: z.boolean().optional().catch(undefined),
  payment_required: z.boolean().optional().catch(undefined),
  restricted_writes: z.boolean().optional().catch(undefined),
});

// `icon` may be an https URL or an inline data: URI (buzz ships a base64 PNG);
// the 64KB cap keeps a hostile relay from persisting megabytes into
// AsyncStorage. `pubkey`/`contact` are `.nullable()` because relays send
// explicit `null` (NIP-11 permits it; buzz does).
export const RelayInformationSchema = z.looseObject({
  name: z.string().max(256).optional().catch(undefined),
  description: z.string().max(4096).optional().catch(undefined),
  pubkey: z.string().max(128).nullable().optional().catch(undefined),
  contact: z.string().max(256).nullable().optional().catch(undefined),
  software: z.string().max(512).optional().catch(undefined),
  version: z.string().max(64).optional().catch(undefined),
  icon: z.string().max(65_536).optional().catch(undefined),
  supported_nips: z.array(z.number().int()).max(256).optional().catch(undefined),
  supported_extensions: z.array(z.string().max(64)).max(64).optional().catch(undefined),
  limitation: RelayLimitationSchema.optional().catch(undefined),
});

export type RelayInformation = z.infer<typeof RelayInformationSchema>;

type RelayInfoError = { type: 'fetch-failed' } | { type: 'invalid' };

const FETCH_TIMEOUT_MS = 6_000;

/** `wss://relay.example/` → `https://relay.example/`. */
function toHttpUrl(relayUrl: string): string {
  return relayUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
}

/** Fetches a relay's NIP-11 document. Pure fetch — no cache (see fileoverview). */
export function fetchRelayInformation(
  relayUrl: string
): ResultAsync<RelayInformation, RelayInfoError> {
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
        const parsed = RelayInformationSchema.safeParse(await res.json());
        if (!parsed.success) throw new Error('invalid nip-11 document');
        return parsed.data;
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
