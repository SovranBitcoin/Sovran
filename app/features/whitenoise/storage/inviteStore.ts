import type { InviteStore, ReceivedGiftWrap, UnreadInvite } from '@internet-privacy/marmot-ts';
import { AsyncStorageKVBackend } from './asyncStorageBackend';
import { WhitenoiseNamespace, whitenoisePrefix } from './namespaces';

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
      whitenoisePrefix(accountIndex, WhitenoiseNamespace.InviteReceived)
    ),
    unread: new AsyncStorageKVBackend<UnreadInvite>(
      whitenoisePrefix(accountIndex, WhitenoiseNamespace.InviteUnread)
    ),
    seen: new AsyncStorageKVBackend<boolean>(
      whitenoisePrefix(accountIndex, WhitenoiseNamespace.InviteSeen)
    ),
  };
}
