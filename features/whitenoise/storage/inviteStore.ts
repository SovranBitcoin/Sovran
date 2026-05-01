import type {
  InviteStore,
  ReceivedGiftWrap,
  UnreadInvite,
} from '@internet-privacy/marmot-ts';
import { AsyncStorageKVBackend } from './asyncStorageBackend';

/**
 * Three persisted key-value backends marmot-ts's `InviteReader` needs:
 *
 *   - received: encrypted gift wraps awaiting decryption
 *   - unread:   decrypted welcome rumors awaiting user action (accept/decline)
 *   - seen:     event-id dedup so the same gift wrap isn't reprocessed
 *
 * All three are namespaced per-account so multiple profiles can't see
 * each other's invites.
 */
export function createWhitenoiseInviteStore(accountIndex: number): InviteStore {
  return {
    received: new AsyncStorageKVBackend<ReceivedGiftWrap>(
      `whitenoise:${accountIndex}:invite-received`
    ),
    unread: new AsyncStorageKVBackend<UnreadInvite>(
      `whitenoise:${accountIndex}:invite-unread`
    ),
    seen: new AsyncStorageKVBackend<boolean>(
      `whitenoise:${accountIndex}:invite-seen`
    ),
  };
}
