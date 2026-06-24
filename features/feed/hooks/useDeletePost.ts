import { useCallback } from 'react';
import NDK, { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { EventDeletion } from 'nostr-tools/kinds';

import { nostrLog } from '@/shared/lib/logger';
import { deleteStatusPopup, popup } from '@/shared/lib/popup';
import { deleteFromBlossom } from '@/shared/lib/nostr/media/blossomClient';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { getOwnWriteRelays, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useDeleteStatusStore } from '@/shared/stores/runtime/deleteStatusStore';

import { parseImetaTags } from '../components/nostr/feedParse';
import type { FeedEvent } from '../components/nostr/feedTypes';

/** scheme+host the blob lives on; deletion must target the URL's own origin. */
function blobOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function relayDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Guards against a double-tap kicking off two concurrent delete flows for the
// same note (the second would race the first's leg updates).
const inFlight = new Set<string>();

/**
 * Deletes one of OUR OWN posts: best-effort BUD-11 delete of each image blob it
 * declared (imeta `x`), then a NIP-09 kind:5 deletion request fanned across
 * every configured relay — including disabled ones, since the note may have
 * been published there too. Drives the red segmented Delete toast: one segment
 * per image + one per relay.
 *
 * Deletion is a *request*: we only mark the note "delete requested" (→ greyed
 * tombstone) once at least one relay accepts the kind:5. If every relay rejects
 * it, the toast ends in the failed state and the post stays visible.
 *
 * Pure of React (the hook below only supplies `ndk`/`pubkey`) so the
 * orchestration is unit-testable.
 */
export async function executeDeletePost({
  ndk,
  pubkey,
  event,
}: {
  ndk: NDK;
  pubkey: string;
  event: FeedEvent;
}): Promise<void> {
  // Author gate — Sovran holds the signing key, so the active pubkey is the
  // authoritative author. Never delete someone else's post.
  if (event.pubkey.toLowerCase() !== pubkey.toLowerCase()) {
    nostrLog.warn('nostr.delete.not_author', { eventId: event.id.slice(0, 8) });
    return;
  }

  if (inFlight.has(event.id)) {
    nostrLog.debug('nostr.delete.already_in_flight', { eventId: event.id.slice(0, 8) });
    return;
  }
  inFlight.add(event.id);

  const store = useDeleteStatusStore.getState();
  try {
    // 1. Deletable blobs — only those THIS note declared via imeta `x`. We
    //    never parse arbitrary content URLs (they may be others' blobs).
    const blobs: { sha256: string; origin: string }[] = [];
    for (const info of parseImetaTags(event.tags).values()) {
      if (!info.sha256) continue;
      const origin = blobOrigin(info.url);
      if (!origin) continue;
      blobs.push({ sha256: info.sha256, origin });
    }

    // 2. Every relay, including disabled ones (uploaded-there guard).
    const allEntries = useRelayListStore.getState().entries.map((e) => e.url);
    const relayUrls = allEntries.length ? Array.from(new Set(allEntries)) : getOwnWriteRelays();

    // 3. Legs: images first, then relays.
    const imageLegs = blobs.map((_, idx) => ({ id: `img-${idx}`, label: `Image ${idx + 1}` }));
    const relayLegs = relayUrls.map((url) => ({ id: `relay-${url}`, label: relayDomain(url) }));

    nostrLog.info('nostr.delete.start', {
      eventId: event.id.slice(0, 8),
      imageCount: blobs.length,
      relayCount: relayUrls.length,
    });

    store.start({
      id: `delete-${event.id}-${Date.now()}`,
      legs: [...imageLegs, ...relayLegs],
      meta: { noteId: event.id },
    });
    deleteStatusPopup();

    // 4. Delete blobs sequentially — a fresh delete auth is signed per blob.
    for (let idx = 0; idx < blobs.length; idx += 1) {
      const legId = `img-${idx}`;
      store.setActiveLeg(legId);
      const res = await deleteFromBlossom({
        ndk,
        server: blobs[idx].origin,
        sha256: blobs[idx].sha256,
      });
      // A blob we don't own (403) or one already gone (404) is non-fatal —
      // the note deletion is the action that matters.
      if (res.isErr()) store.setLegFailed(legId, res.error.type);
      else store.setLegDone(legId);
    }

    // 5. NIP-09 kind:5 — signed ONCE, published to every relay. The seam
    //    dedupes by event id, so a per-relay loop would collapse to one
    //    publish; instead drive per-relay legs from `onRelayResult`.
    const deleteEvent = new NDKEvent(ndk);
    deleteEvent.kind = EventDeletion;
    deleteEvent.content = 'Deleted by the author';
    deleteEvent.tags = [
      ['e', event.id],
      // `k` keeps NIP-46 from escalating the kind:5 to a 'critical' prompt.
      ['k', '1'],
    ];
    deleteEvent.created_at = Math.floor(Date.now() / 1000);

    const result = await publishEvent({
      ndk,
      event: deleteEvent,
      relays: relayUrls,
      resolveOn: 'all-settled',
      onRelayResult: (r) => {
        const legId = `relay-${r.url}`;
        if (r.ok) store.setLegDone(legId);
        else store.setLegFailed(legId, r.reason);
      },
    });

    const anyAccepted = result.isOk() && result.value.anyAccepted;
    if (anyAccepted) {
      // Only now is it really "delete requested" — show the tombstone.
      useNostrSocialStore.getState().markDeleteRequested(event.id);
      nostrLog.info('nostr.delete.requested', { eventId: event.id.slice(0, 8) });
      store.complete();
    } else {
      nostrLog.warn('nostr.delete.no_relay_accepted', { eventId: event.id.slice(0, 8) });
      store.fail('No relay accepted the deletion');
    }
  } catch (e) {
    nostrLog.warn('nostr.delete.error', { eventId: event.id.slice(0, 8) });
    store.fail();
    throw e;
  } finally {
    inFlight.delete(event.id);
  }
}

/** Returns a callback that deletes one of the active user's own posts. */
export function useDeletePost() {
  const { ndk } = useNDK();
  const { keys } = useNostrKeysContext();

  return useCallback(
    async (event: FeedEvent): Promise<void> => {
      const pubkey = keys?.pubkey;
      // Always log the entry: a "nothing happened" report must never be a black
      // box. `executeDeletePost` logs from `nostr.delete.start` onward.
      nostrLog.info('nostr.delete.invoked', {
        eventId: event.id.slice(0, 8),
        hasNdk: !!ndk,
        hasPubkey: !!pubkey,
      });
      if (!ndk || !pubkey) {
        // The signer/NDK isn't ready — surface it instead of silently no-op'ing.
        nostrLog.warn('nostr.delete.unavailable', { hasNdk: !!ndk, hasPubkey: !!pubkey });
        popup({
          message: 'Could not start deletion',
          text: 'Your signing key is still loading — try again in a moment.',
          type: 'error',
        });
        return;
      }
      await executeDeletePost({ ndk, pubkey, event });
    },
    [ndk, keys]
  );
}
