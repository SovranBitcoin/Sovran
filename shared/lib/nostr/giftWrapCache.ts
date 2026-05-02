import { unwrapGiftWrap, type UnwrappedDM } from './nip17';
import { nostrLog } from '@/shared/lib/logger';
import { createPubkeyScopedCache } from '@/shared/lib/cache/createPubkeyScopedCache';

const cache = createPubkeyScopedCache<UnwrappedDM>({
  storagePrefix: 'nip17-unwrap-cache:v1',
  storagePrefixNeg: 'nip17-unwrap-cache-neg:v1',
  log: nostrLog,
  validate: (v): v is UnwrappedDM => !!v && typeof (v as UnwrappedDM).senderPubkey === 'string',
});

export const hydrateGiftWrapCache = cache.hydrate;
export const getCachedUnwrap = cache.get;
export const putUnwrap = cache.put;

export function unwrapGiftWrapCached(
  recipientPubkey: string,
  wrapEvent: { id: string; content: string; pubkey: string },
  recipientPrivateKey: Uint8Array
): UnwrappedDM | null {
  const hit = cache.get(recipientPubkey, wrapEvent.id);
  if (hit) return hit;
  if (cache.isKnownFailed(recipientPubkey, wrapEvent.id)) return null;
  const unwrapped = unwrapGiftWrap(
    { content: wrapEvent.content, pubkey: wrapEvent.pubkey },
    recipientPrivateKey
  );
  if (unwrapped) {
    cache.put(recipientPubkey, wrapEvent.id, unwrapped);
  } else {
    cache.markFailed(recipientPubkey, wrapEvent.id);
  }
  return unwrapped;
}
