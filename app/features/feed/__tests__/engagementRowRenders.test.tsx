/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoists module factories before static imports. */
/**
 * Liking one note re-renders that note's card and no other, in the home feed
 * and in a thread.
 *
 * The list is a stand-in with FlashList's own cell contract: a cell re-renders
 * when its item, index, `extraData` or `renderItem` changes identity
 * (`ViewHolder`'s comparator). `PostCard` is a stand-in with the real one's
 * `React.memo`, counting renders per note — so a fresh prop identity handed to
 * an untouched row shows up here exactly as it would on device.
 */
import type { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { HomeFeed } from '../components/HomeFeed';
import { ThreadView } from '../components/ThreadView';
import type { FeedEvent, NoteMetrics } from '../components/nostr/feedTypes';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

type CardProps = {
  event: FeedEvent;
  metrics: NoteMetrics;
  liked?: boolean;
  likePending?: boolean;
  onLikePress?: () => void;
};
const mockCards = {
  renders: new Map<string, number>(),
  props: new Map<string, CardProps>(),
};
const mockPublish = jest.fn();
const mockThread: { current: unknown } = { current: null };
const mockFeedPage: { current: unknown } = { current: null };

function mockRecyclingList() {
  const React = require('react');
  type CellProps = {
    item: unknown;
    index: number;
    extraData: unknown;
    renderItem: (info: { item: unknown; index: number }) => ReactNode;
  };
  const Cell = React.memo(
    function Cell({ item, index, renderItem }: CellProps) {
      return renderItem({ item, index });
    },
    (prev: CellProps, next: CellProps) =>
      prev.item === next.item &&
      prev.index === next.index &&
      prev.extraData === next.extraData &&
      prev.renderItem === next.renderItem
  );
  return function RecyclingList(props: {
    data: unknown[];
    extraData?: unknown;
    keyExtractor: (item: unknown, index: number) => string;
    renderItem: CellProps['renderItem'];
  }) {
    return props.data.map((item, index) =>
      React.createElement(Cell, {
        key: props.keyExtractor(item, index),
        item,
        index,
        extraData: props.extraData,
        renderItem: props.renderItem,
      })
    );
  };
}

jest.mock('@shopify/flash-list', () => ({ FlashList: mockRecyclingList() }));
jest.mock('@/shared/ui/composed/List', () => ({ List: mockRecyclingList() }));
jest.mock('../components/nostr/PostCard', () => {
  const React = require('react');
  return {
    PostCardSkeleton: () => null,
    PostCard: React.memo(function PostCard(props: CardProps) {
      const id = props.event.id;
      mockCards.renders.set(id, (mockCards.renders.get(id) ?? 0) + 1);
      mockCards.props.set(id, props);
      return React.createElement(
        'Text',
        { testID: `card-${id}` },
        `${props.metrics.likeCount}${props.liked ? ' liked' : ''}${props.likePending ? ' pending' : ''}`
      );
    }),
  };
});

// ── engagement's own collaborators ──
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  useNDK: () => ({ ndk: {} }),
  NDKEvent: class {},
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (args: unknown) => mockPublish(args),
}));
jest.mock('@/shared/lib/popup', () => ({ paramPopup: jest.fn(), actionMenuPopup: jest.fn() }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'viewer' } }),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  readNoteMetrics: () => undefined,
  useNoteStats: () => ({ metrics: undefined, status: 'absent' }),
  useProfile: () => ({ profile: undefined, status: 'absent' }),
}));
jest.mock('@/shared/lib/nostr/fetchNoteStats', () => ({
  ingestFeedMetrics: jest.fn(),
  backfillNoteStats: jest.fn(),
}));

// ── screen furniture neither surface needs here ──
jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 80 }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: require('react-native').View },
  FadeIn: { duration: () => ({}) },
}));
jest.mock('@/shared/ui/composed/IdentityHeader', () => ({
  useIdentityHeader: () => ({
    probe: null,
    headerBand: null,
    headerTitle: undefined,
    contentStyle: undefined,
    scrollY: { set: jest.fn() },
  }),
}));
jest.mock('@/shared/ui/composed/Screen', () => ({ useScreenOptions: jest.fn() }));
jest.mock('@/shared/ui/composed/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: require('react-native').View }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: require('react-native').Pressable,
}));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('assets/icons', () => () => null);
jest.mock('heroui-native', () => ({ Button: () => null }));
jest.mock('@/shared/blocks/PullToAiRefreshControl', () => ({
  usePullToAiRefreshControl: () => ({ refreshControl: undefined }),
}));
jest.mock('@/shared/providers/BackgroundProvider', () => ({ useBackgroundConfig: jest.fn() }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { push: jest.fn() } }));
jest.mock('@/features/composer/ui/ComposeFab', () => ({ COMPOSE_FAB_CLEARANCE: 0 }));
jest.mock('@/features/composer/publish/useComposerActions', () => ({
  useOpenComposer: () => jest.fn(),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (value: string | string[]) =>
    Array.isArray(value) ? value.map(() => 'black') : 'black',
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/lib/contentShiftLog', () => ({ useVisualStateLogger: jest.fn() }));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    feedLog: sink,
    storeLog: sink,
    log: sink,
    SHOW_LOGS: false,
    redactError: (error: unknown) => error,
    Log: ({ children }: { children: ReactNode }) => children,
    useWhyDidRender: () => {},
    useStateChangeLogger: () => {},
    useQueryResultLogger: () => {},
    countRowRender: () => {},
  };
});
jest.mock('../components/UserFeed', () => ({ RepostCard: () => null, FeedRepostCard: () => null }));
jest.mock('../components/nostr/image-overlay', () => ({
  ImageOverlayProvider: ({ children }: { children: ReactNode }) => children,
  useImageOverlay: () => null,
  AnimatedImageOverlay: () => null,
  trackFeedScrollOffset: jest.fn(),
}));
jest.mock('../components/thread-embed', () => ({
  ThreadEmbedProvider: ({ children }: { children: ReactNode }) => children,
  ThreadEmbedSheet: ({ children }: { children: ReactNode }) => children,
  useThreadEmbed: () => null,
  LinkEmbedView: () => null,
  EmbedActionBar: () => null,
}));
jest.mock('../components/ThreadReplyBar', () => ({ ThreadReplyBar: () => null }));
jest.mock('../hooks/usePostActions', () => ({ usePostActions: () => jest.fn() }));
jest.mock('../hooks/useZap', () => ({ useZap: () => ({ openZapMenu: jest.fn() }) }));
jest.mock('../hooks/useThread', () => ({ useThread: () => mockThread.current }));
jest.mock('../lib/replyTarget', () => ({ deriveReplyTarget: jest.fn() }));
jest.mock('../lib/useQuotePost', () => ({ useQuotePost: () => jest.fn() }));
jest.mock('../stores/ignoreStore', () => {
  const state = { ignoredPubkeys: [], ignoredEventIds: [] };
  return { useFeedIgnoreStore: (select: (value: typeof state) => unknown) => select(state) };
});
jest.mock('../data/useFeedClient', () => ({
  getFeedClient: () => ({
    getFeed: async () => mockFeedPage.current,
    enrich: async () => ({}),
  }),
}));

const note = (id: string): FeedEvent => ({
  id: id.repeat(64),
  pubkey: 'f'.repeat(64),
  kind: 1,
  created_at: 1,
  content: id,
  tags: [],
});
const A = note('a');
const B = note('b');
const COUNTS: NoteMetrics = { likeCount: 5, repostCount: 0, replyCount: 0, satsZapped: 0 };
const METRICS = new Map([
  [A.id, COUNTS],
  [B.id, COUNTS],
]);

const card = (event: FeedEvent) => screen.getByTestId(`card-${event.id}`).props.children as string;
const renders = (event: FeedEvent) => mockCards.renders.get(event.id) ?? 0;
const settle = () => act(async () => {});

/** Like `A` from its own card, let the publish land, and report who re-rendered. */
async function likeAAndCountRenders() {
  const before = { a: renders(A), b: renders(B) };
  act(() => mockCards.props.get(A.id)?.onLikePress?.());
  const optimistic = card(A);
  await settle();
  return { a: renders(A) - before.a, b: renders(B) - before.b, optimistic };
}

beforeEach(() => {
  mockCards.renders.clear();
  mockCards.props.clear();
  mockPublish.mockReset().mockImplementation(async ({ event }: { event: { id?: string } }) => {
    event.id = 'own-like';
    return { isErr: () => false };
  });
  useNostrSocialStore.setState({
    engagementByEventId: {},
    optimisticLikesByEventId: {},
    optimisticRepostsByEventId: {},
    optimisticZapsByEventId: {},
    zappedByEventId: {},
  });
});

test('home feed: liking a note re-renders its card and not its neighbour', async () => {
  mockFeedPage.current = {
    orderedFeedItems: [
      { type: 'note', event: A, timestamp: 2 },
      { type: 'note', event: B, timestamp: 1 },
    ],
    metricsMap: METRICS,
    quotedEventsMap: new Map(),
    profilesMap: new Map(),
    missingQuotedIds: [],
    missingProfilePubkeys: [],
  };
  render(<HomeFeed />);
  await settle();
  expect(card(A)).toBe('5');
  expect(card(B)).toBe('5');

  const delta = await likeAAndCountRenders();

  expect(delta.optimistic).toBe('6 liked pending');
  expect(card(A)).toBe('6 liked');
  expect(card(B)).toBe('5');
  expect(delta.a).toBe(2);
  expect(delta.b).toBe(0);
});

test('thread: liking a reply re-renders its card and not the note above it', async () => {
  mockThread.current = {
    items: [
      { type: 'target', event: B },
      { type: 'reply', event: A },
    ],
    isLoading: false,
    isFetching: false,
    isLoadingMoreReplies: false,
    hasMoreReplies: false,
    replySort: 'latest',
    setReplySort: jest.fn(),
    error: null,
    dataVersion: 1,
    profilesRef: { current: new Map() },
    metricsRef: { current: METRICS },
    quotedEventsRef: { current: new Map() },
    loadMoreReplies: jest.fn(),
  };
  render(<ThreadView eventId={B.id} />);
  await settle();
  expect(card(A)).toBe('5');
  expect(card(B)).toBe('5');

  const delta = await likeAAndCountRenders();

  expect(delta.optimistic).toBe('6 liked pending');
  expect(card(A)).toBe('6 liked');
  expect(card(B)).toBe('5');
  expect(delta.a).toBe(2);
  expect(delta.b).toBe(0);
});
