/**
 * @fileoverview `useOwnSocialGraphSeed` — one-shot seed of the viewer's follow
 * set from the tiered nagg-ts facade (nagg → Primal → raw relays), the
 * read-side companion to `useOwnEventsSync`.
 *
 * Per ADR 0003 the facade is the seed/backfill source; the relay subscription in
 * `useOwnEventsSync` survives as the live-delta listener. Both feed the SAME
 * `nostrSocialStore` through its last-writer-wins gate (kind-3 `created_at`), so
 * a facade seed and a relay delta can't fight. This hook only seeds the read
 * side (`followingPubkeys`); the raw kind-3 (`contactsTags`/`content`) that the
 * follow/unfollow write path re-publishes stays owned by the relay sub, which
 * preserves the relay hints + petnames the facade's parsed `follows` drop.
 *
 * Fires once per pubkey. Best-effort: a disabled/exhausted tier chain is a
 * no-op (the relay sub still seeds the store the old way).
 */
import { useEffect, useRef } from 'react';

import { nostrLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

export function useOwnSocialGraphSeed(): void {
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;

  // One seed per pubkey — a not-found / empty graph must not re-loop the effect.
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!pubkey || seededFor.current === pubkey) return;
    seededFor.current = pubkey;

    const layer = buildNostrDataLayer();
    if (!layer) {
      nostrLog.debug('nostr.ownsync.socialGraph.no_tiers');
      return;
    }

    let cancelled = false;
    void layer.getSocialGraph({ pubkey }).then((result) => {
      if (cancelled) return;
      result.match(
        (graph) => {
          nostrLog.info('nostr.ownsync.socialGraph.seeded', {
            tier: graph.tier,
            follows: graph.follows.length,
            contactsUpdatedAt: graph.contactsUpdatedAt,
          });
          useNostrSocialStore.getState().seedFollowsFromFacade({
            follows: graph.follows,
            createdAt: graph.contactsUpdatedAt,
          });
        },
        (error) =>
          nostrLog.debug('nostr.ownsync.socialGraph.exhausted', {
            attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
          })
      );
    });

    return () => {
      cancelled = true;
    };
  }, [pubkey]);
}
