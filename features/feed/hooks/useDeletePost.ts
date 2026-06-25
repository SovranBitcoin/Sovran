import { useCallback } from 'react';
import NDK, { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { EventDeletion } from 'nostr-tools/kinds';

import { nostrLog } from '@/shared/lib/logger';
import { deleteStatusPopup, popup } from '@/shared/lib/popup';
import { checkBlobExists, deleteFromBlossom } from '@/shared/lib/nostr/media/blossomClient';
import { extractOwnedBlobs } from '@/shared/lib/nostr/media/ownedBlobs';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { safeNormalizeRelay } from '@/shared/lib/nostr/outbox/defaults';
import { getOwnWriteRelays, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useOwnedMediaStore } from '@/shared/stores/profile/ownedMediaStore';
import { useDeleteStatusStore } from '@/shared/stores/runtime/deleteStatusStore';

import { parseImetaTags } from '../components/nostr/feedParse';
import type { FeedEvent } from '../components/nostr/feedTypes';

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
 * every relay currently in the user's relay list, since the note may have been
 * published to any of them. Drives the red segmented Delete toast: one segment
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
    // 1. Deletable blobs — imeta (authoritative) plus blossom-shaped content
    //    URLs, the same set the owned-media store tracks. Record them durably
    //    first so the delete state is reflected even for a blob not yet ingested.
    const imeta = parseImetaTags(event.tags);
    let imetaMissingHash = 0;
    for (const info of imeta.values()) {
      // An imeta image with no `x` can't be content-addressed for delete
      // (e.g. posted by another client). Counted so a "0 images deleted" on an
      // image post is explainable rather than mysterious.
      if (!info.sha256) imetaMissingHash += 1;
    }
    const blobs = extractOwnedBlobs(event);
    const ownedMedia = useOwnedMediaStore.getState();
    ownedMedia.recordBlobs(blobs, event.id);

    // 2. Every relay currently in the list. Normalize + dedup so each
    //    `relay-${url}` leg id matches the (normalized) URL `publishEvent`
    //    reports back via onRelayResult — otherwise legs never settle on the
    //    common default relays (raw `wss://x` vs normalized `wss://x/`).
    const rawEntries = useRelayListStore.getState().entries.map((e) => e.url);
    const rawUrls = rawEntries.length ? rawEntries : getOwnWriteRelays();
    const relayUrls = Array.from(new Set(rawUrls.map((u) => safeNormalizeRelay(u) ?? u)));

    // 3. Legs: images first, then relays.
    const imageLegs = blobs.map((_, idx) => ({ id: `img-${idx}`, label: `Image ${idx + 1}` }));
    const relayLegs = relayUrls.map((url) => ({ id: `relay-${url}`, label: relayDomain(url) }));

    nostrLog.info('nostr.delete.start', {
      eventId: event.id.slice(0, 8),
      imetaMediaCount: imeta.size,
      imetaMissingHash,
      deletableBlobs: blobs.length,
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
    //    Each blob's owned-media state moves requested → deleted/delete-failed.
    let imagesDeleted = 0;
    let imagesFailed = 0;
    for (let idx = 0; idx < blobs.length; idx += 1) {
      const blob = blobs[idx];
      const legId = `img-${idx}`;
      store.setActiveLeg(legId);
      ownedMedia.setDeleteState(blob.host, blob.sha256, 'delete-requested');
      const res = await deleteFromBlossom({ ndk, server: blob.host, sha256: blob.sha256 });

      // Primal returns 404 for "already gone" AND "not owned" — a HEAD probe of
      // the URL disambiguates so we don't mark a blob we can't actually delete
      // as deleted. A non-404 failure is left as delete-failed.
      let deleted = res.isOk();
      if (
        !deleted &&
        res.isErr() &&
        res.error.type === 'delete-failed' &&
        res.error.status === 404
      ) {
        if ((await checkBlobExists(blob.url)) === false) deleted = true;
      }

      if (deleted) {
        imagesDeleted += 1;
        store.setLegDone(legId);
        ownedMedia.setDeleteState(blob.host, blob.sha256, 'deleted');
        nostrLog.info('nostr.delete.image', {
          index: idx,
          host: blob.host,
          sha256: blob.sha256.slice(0, 12),
          ok: true,
        });
      } else {
        imagesFailed += 1;
        const error = res.isErr() ? res.error.type : 'unknown';
        store.setLegFailed(legId, error);
        ownedMedia.setDeleteState(blob.host, blob.sha256, 'delete-failed');
        nostrLog.warn('nostr.delete.image', {
          index: idx,
          host: blob.host,
          sha256: blob.sha256.slice(0, 12),
          ok: false,
          error,
        });
      }
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
      // Best-effort scrub: cap each relay at ~8s with no retries so one dead
      // relay can't hold the toast for the full retry budget (~30s). Reachable
      // relays accept in well under a second; the deletion is idempotent and
      // re-broadcastable later (see deletedNoteIds), so we don't hammer.
      timeoutMs: 8000,
      retry: { attempts: 0 },
      onRelayResult: (r) => {
        const legId = `relay-${r.url}`;
        if (r.ok) {
          store.setLegDone(legId);
          nostrLog.info('nostr.delete.relay', { url: r.url, ok: true, durationMs: r.durationMs });
        } else {
          store.setLegFailed(legId, r.reason);
          nostrLog.warn('nostr.delete.relay', {
            url: r.url,
            ok: false,
            reason: r.reason,
            durationMs: r.durationMs,
          });
        }
      },
    });

    const relaysAccepted = result.isOk() ? result.value.accepted.length : 0;
    const relaysFailed = result.isOk() ? result.value.failed.length : 0;
    const anyAccepted = result.isOk() && result.value.anyAccepted;
    if (anyAccepted) {
      // Only now is it really "delete requested" — show the tombstone.
      useNostrSocialStore.getState().markDeleteRequested(event.id);
      nostrLog.info('nostr.delete.requested', {
        eventId: event.id.slice(0, 8),
        imagesDeleted,
        imagesFailed,
        relaysAccepted,
        relaysFailed,
      });
      store.complete();
    } else {
      nostrLog.warn('nostr.delete.no_relay_accepted', {
        eventId: event.id.slice(0, 8),
        imagesDeleted,
        imagesFailed,
        relaysFailed,
      });
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
