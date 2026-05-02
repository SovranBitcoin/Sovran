import { nostrLog } from '@/shared/lib/logger';
import { createPubkeyScopedCache } from '@/shared/lib/cache/createPubkeyScopedCache';

const cache = createPubkeyScopedCache<string>({
  storagePrefix: 'nip04-cache:v1',
  storagePrefixNeg: 'nip04-cache-neg:v1',
  log: nostrLog,
  validate: (v): v is string => typeof v === 'string',
});

export const hydrateNip04Cache = cache.hydrate;
export const getCachedNip04Plaintext = cache.get;
export const putNip04Plaintext = cache.put;
export const isKnownFailedNip04 = cache.isKnownFailed;
export const markNip04Failed = cache.markFailed;
