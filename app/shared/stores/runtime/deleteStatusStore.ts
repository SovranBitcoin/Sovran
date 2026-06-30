/**
 * Runtime store for the post Delete status toast.
 *
 * Deleting a post is a sequence of legs: one per image blob (BUD-11 delete on
 * its Blossom server) followed by one per relay (NIP-09 kind:5 publish). The
 * red segmented ring + toast subscribe to this store and advance as each leg
 * settles. Built from the shared `createLegProgressStore` factory — same leg
 * state machine as the swap toast, different surface.
 *
 * Not persisted — a delete is a one-shot per-session action.
 */

import { nostrLog } from '@/shared/lib/logger';

import { createLegProgressStore } from './legProgress';

interface DeleteMeta {
  /** The note being deleted — for log correlation. */
  noteId: string;
}

export const useDeleteStatusStore = createLegProgressStore<DeleteMeta>({
  name: 'delete',
  log: nostrLog,
});
