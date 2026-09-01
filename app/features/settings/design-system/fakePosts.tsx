/* eslint-disable @typescript-eslint/no-require-imports -- catalog metadata must stay import-side-effect free; the feed graph (NDK, expo-video, wallet/react) loads only when a fake post is rendered. */
/**
 * Fake feed posts for the design system — every RelayCard situation rendered
 * against fixture content so the inline relay card can be inspected without
 * hunting for real posts (or depending on live relays).
 *
 * Deterministic states come from seeding `relayMetadataStore` with fixture
 * entries on reserved `.example` hosts (RFC 2606 — they can never resolve, so
 * even an accidental fetch dies fast). Seeds are refcounted: retained by the
 * first mounted fake post, removed from the store when the last one unmounts,
 * so fixture rows don't linger in the persisted cache after leaving the screen.
 */
import { useLayoutEffect, useMemo } from 'react';

import type {
  FeedEvent,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import type { RelayInformation } from '@/shared/lib/nostr/nip11';
import { relayMetadataKey, useRelayMetadataStore } from '@/shared/stores/global/relayMetadataStore';

import type { DesignSystemScenario } from './types';

const RELAY_CARD_SOURCE = 'features/feed/components/nostr/RelayCard.tsx';
const POST_CARD_SOURCE = 'features/feed/components/nostr/PostCard.tsx';

// ─── Fixture relays (seeded into relayMetadataStore) ─────────────────────────

const BRANDED_RELAY = 'wss://buzz.team.example';
const NEUTRAL_RELAY = 'wss://open.team.example';
/** Seeded as a cached failure: the card falls back to domain + glyph. */
const FALLBACK_RELAY = 'wss://dead.team.example';
/** Real relay — exercises the live NIP-11 pipeline when the sim has network. */
const LIVE_BUZZ_RELAY = 'wss://buzz.cashu.space';

const CHARTREUSE_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4fl0PAARlAd1YEhfUAAAAAElFTkSuQmCC';
const PURPLE_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPI8pkMAAJtAUpX8IUhAAAAAElFTkSuQmCC';

/** Mirrors the real wss://buzz.cashu.space document (2026-07). */
const BRANDED_INFO: RelayInformation = {
  name: 'Buzz Relay',
  icon: CHARTREUSE_ICON,
  software: 'https://github.com/block/buzz',
};

const NEUTRAL_INFO: RelayInformation = {
  name: 'Open Relay',
  icon: PURPLE_ICON,
  software: 'https://github.com/example/generic-relay',
};

const SEEDED_INFO: readonly (readonly [string, RelayInformation])[] = [
  [BRANDED_RELAY, BRANDED_INFO],
  [NEUTRAL_RELAY, NEUTRAL_INFO],
];

let fixtureRefs = 0;

function retainRelayFixtures() {
  if (fixtureRefs++ > 0) return;
  const now = Date.now();
  useRelayMetadataStore.setState((state) => {
    const next = { ...state.byRelayUrl };
    for (const [url, info] of SEEDED_INFO) next[relayMetadataKey(url)] = { info, fetchedAt: now };
    next[relayMetadataKey(FALLBACK_RELAY)] = { failedAt: now };
    return { byRelayUrl: next };
  });
}

function releaseRelayFixtures() {
  if (--fixtureRefs > 0) return;
  useRelayMetadataStore.setState((state) => {
    const next = { ...state.byRelayUrl };
    for (const [url] of SEEDED_INFO) delete next[relayMetadataKey(url)];
    delete next[relayMetadataKey(FALLBACK_RELAY)];
    return { byRelayUrl: next };
  });
}

/** Layout effect so the seed lands before RelayCard's mount revalidation —
 *  child passive effects would otherwise fire a doomed fetch first. */
function useRelayFixtures() {
  useLayoutEffect(() => {
    retainRelayFixtures();
    return releaseRelayFixtures;
  }, []);
}

// ─── Fixture posts ───────────────────────────────────────────────────────────

const ALICE_PK = 'a1'.repeat(32);
const BOB_PK = 'b2'.repeat(32);

const PROFILES = new Map<string, ProfileInfo>([
  [ALICE_PK, { name: 'alice' }],
  [BOB_PK, { name: 'bob' }],
]);

const METRICS: NoteMetrics = { likeCount: 12, repostCount: 3, replyCount: 4, satsZapped: 2100 };
const getMetrics = () => METRICS;
const EMPTY_QUOTED: Map<string, FeedEvent> = new Map();

function makeEvent(
  idSeed: string,
  pubkey: string,
  content: string,
  opts?: { minutesAgo?: number; tags?: string[][] }
): FeedEvent {
  return {
    id: idSeed.repeat(32).slice(0, 64),
    kind: 1,
    pubkey,
    content,
    tags: opts?.tags ?? [],
    created_at: Math.floor(Date.now() / 1000) - (opts?.minutesAgo ?? 12) * 60,
  };
}

function FakePost({ event, quoted }: { event: FeedEvent; quoted?: FeedEvent }) {
  // Lazy so importing the catalog (component-inventory / scenario-snapshot
  // tests) doesn't drag the full feed graph (NDK, expo-video, wallet/react)
  // into module resolution — same trick as walletControls' KeyboardPreview.
  const { PostCard } = require('@/features/feed/components/nostr/PostCard') as {
    PostCard: typeof import('@/features/feed/components/nostr/PostCard').PostCard;
  };
  useRelayFixtures();
  const quotedEvents = useMemo(
    () => (quoted ? new Map([[quoted.id, quoted]]) : EMPTY_QUOTED),
    [quoted]
  );
  return (
    <PostCard
      event={event}
      metrics={METRICS}
      quotedEvents={quotedEvents}
      profiles={PROFILES}
      getMetrics={getMetrics}
      variant="feed"
    />
  );
}

const QUOTED_EVENT = makeEvent('d4', BOB_PK, `our new team relay: ${NEUTRAL_RELAY}`, {
  minutesAgo: 90,
});

export const FAKE_POST_SCENARIOS = [
  {
    id: 'text-baseline',
    title: 'Plain post (baseline)',
    covers: [POST_CARD_SOURCE],
    render: () => (
      <FakePost
        event={makeEvent('a0', ALICE_PK, 'just a plain note with no embeds — baseline chrome')}
      />
    ),
  },
  {
    id: 'relay-branded',
    title: 'Branded relay (Buzz — yellow card)',
    covers: [RELAY_CARD_SOURCE],
    render: () => (
      <FakePost
        event={makeEvent(
          'a1',
          ALICE_PK,
          `we moved our team chat to buzz 🐝 come say hi ${BRANDED_RELAY}`
        )}
      />
    ),
  },
  {
    id: 'relay-neutral',
    title: 'Neutral relay (unknown software)',
    covers: [RELAY_CARD_SOURCE],
    render: () => (
      <FakePost event={makeEvent('a2', ALICE_PK, `decent uptime on ${NEUTRAL_RELAY} lately`)} />
    ),
  },
  {
    id: 'relay-fallback',
    title: 'No metadata (domain + glyph)',
    covers: [RELAY_CARD_SOURCE],
    render: () => (
      <FakePost event={makeEvent('a4', BOB_PK, `is ${FALLBACK_RELAY} down for everyone?`)} />
    ),
  },
  {
    id: 'relay-fanout-cap',
    title: 'Relay dump (fetch cap: 3 live + static rest)',
    covers: [RELAY_CARD_SOURCE],
    render: () => (
      <FakePost
        event={makeEvent(
          'a6',
          BOB_PK,
          `my relay list:\n${BRANDED_RELAY}\n${NEUTRAL_RELAY}\n${FALLBACK_RELAY}\nwss://four.team.example\nwss://five.team.example`
        )}
      />
    ),
  },
  {
    id: 'relay-quoted',
    title: 'Quoted post containing a relay',
    covers: [RELAY_CARD_SOURCE, POST_CARD_SOURCE],
    render: () => (
      <FakePost
        event={makeEvent('a7', ALICE_PK, 'this is the one', {
          tags: [['q', QUOTED_EVENT.id]],
        })}
        quoted={QUOTED_EVENT}
      />
    ),
  },
  {
    id: 'relay-mixed-content',
    title: 'Mixed content (text · hashtag · link · relay)',
    covers: [RELAY_CARD_SOURCE],
    render: () => (
      <FakePost
        event={makeEvent(
          'a8',
          BOB_PK,
          `good #nostr writeup at https://example.com/relays — testing against ${NEUTRAL_RELAY}`
        )}
      />
    ),
  },
  {
    id: 'relay-live-buzz',
    title: 'Live fetch (real buzz.cashu.space)',
    covers: [RELAY_CARD_SOURCE],
    render: () => (
      <FakePost
        event={makeEvent('a9', ALICE_PK, `the real thing, fetched live: ${LIVE_BUZZ_RELAY}`)}
      />
    ),
  },
] as const satisfies readonly DesignSystemScenario[];
