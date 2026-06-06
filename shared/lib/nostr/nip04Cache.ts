import { nostrLog } from '@/shared/lib/logger';
import { createPubkeyScopedCache } from '@/shared/lib/cache/createPubkeyScopedCache';

export const nip04Cache = createPubkeyScopedCache<string>({
  storagePrefix: 'nip04-cache:v1',
  storagePrefixNeg: 'nip04-cache-neg:v1',
  log: nostrLog,
  validate: (v): v is string => typeof v === 'string',
});
