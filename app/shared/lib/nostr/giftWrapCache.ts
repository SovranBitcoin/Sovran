import { unwrapGiftWrap, type UnwrappedDM } from './nip17';
import { nostrLog } from '@/shared/lib/logger';
import { createPubkeyScopedCache } from '@/shared/lib/cache/createPubkeyScopedCache';

/** Bearer Cashu tokens and NUT-18 proof payloads must never be persisted to plaintext AsyncStorage. */
const BEARER_ECASH_RE = /\bcashu[AB][A-Za-z0-9_-]{8,}\b/;
function containsBearerEcash(value: UnwrappedDM): boolean {
  const content = value.content;
  if (typeof content !== 'string') return false;
  return BEARER_ECASH_RE.test(content) || content.includes('"proofs"');
}

const cache = createPubkeyScopedCache<UnwrappedDM>({
  storagePrefix: 'nip17-unwrap-cache:v1',
  storagePrefixNeg: 'nip17-unwrap-cache-neg:v1',
  log: nostrLog,
  validate: (v): v is UnwrappedDM =>
    !!v &&
    typeof (v as UnwrappedDM).senderPubkey === 'string' &&
    !containsBearerEcash(v as UnwrappedDM),
  shouldPersist: (v) => !containsBearerEcash(v),
});

export const giftWrapCache = {
  cache,
  unwrap(
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
  },
};
