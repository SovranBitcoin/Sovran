/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoists module factories before static imports. */
/**
 * The home feed's loader (`HomeFeed`'s load, refresh and load-more): what it
 * asks the feed client for, what the list shows meanwhile (skeleton rows,
 * cards, the empty / error state), when the session page cache answers
 * instead of the network, and which answers are dropped as superseded. The
 * component, its loader, the real page cache and the row building run; the
 * feed client, the list, the cards, the pull-to-refresh control and screen
 * furniture are replaced (the same stand-ins as engagementRowRenders.test.tsx).
 *
 * Pins F185's refresh latch and F221's cancelled enrichment as QUIRKs.
 */
import type { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react-native';

import {
  FEED_FILTER_FOLLOWING_POPULAR,
  FEED_FILTER_FOR_YOU,
  HomeFeed,
} from '../components/HomeFeed';
import type { FeedEvent, FeedItem } from '../components/nostr/feedTypes';
import { feedPageCache } from '../data/feedCache';

type GetFeedRequest = {
  spec: string;
  refresh?: boolean;
  loadMore?: boolean;
  cursor?: unknown;
  userPubkey?: string;
  signal?: AbortSignal;
};
type ListProps = {
  data: unknown[];
  keyExtractor: (item: unknown, index: number) => string;
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
  onEndReached: () => void;
};
type Pending = {
  request: GetFeedRequest;
  resolve: (page: unknown) => void;
  reject: (e: unknown) => void;
};

const mockRequests: Pending[] = [];
const mockEnrich: {
  held: boolean;
  calls: { signal?: AbortSignal; resolve: (u: unknown) => void }[];
} = { held: false, calls: [] };
const mockKeys: { pubkey: string | undefined } = { pubkey: 'viewer' };
const mockIgnore = { ignoredPubkeys: [] as string[], ignoredEventIds: [] as string[] };
const mockList: { props: ListProps | null } = { props: null };
const mockPull: { refreshing: boolean; onRefresh: () => void } = {
  refreshing: false,
  onRefresh: () => undefined,
};

jest.mock('../data/useFeedClient', () => ({
  getFeedClient: () => ({
    getFeed: (request: GetFeedRequest) =>
      new Promise((resolve, reject) => mockRequests.push({ request, resolve, reject })),
    enrich: (request: { signal?: AbortSignal }) =>
      new Promise((resolve) => {
        mockEnrich.calls.push({ signal: request.signal, resolve });
        if (!mockEnrich.held) resolve({});
      }),
  }),
}));
jest.mock('@/shared/ui/composed/List', () => {
  const React = require('react');
  return {
    List: (props: ListProps) => {
      mockList.props = props;
      const rows = props.data.map((item: unknown, index: number) =>
        React.createElement(
          React.Fragment,
          { key: props.keyExtractor(item, index) },
          props.renderItem({ item, index })
        )
      );
      return React.createElement(
        React.Fragment,
        null,
        rows.length > 0 ? rows : props.ListEmptyComponent,
        props.ListFooterComponent
      );
    },
  };
});
jest.mock('@/shared/blocks/PullToAiRefreshControl', () => ({
  usePullToAiRefreshControl: (args: { refreshing: boolean; onRefresh: () => void }) => {
    mockPull.refreshing = args.refreshing;
    mockPull.onRefresh = args.onRefresh;
    return { refreshControl: undefined };
  },
}));
jest.mock('../components/nostr/PostCard', () => {
  const React = require('react');
  return {
    PostCardSkeleton: () => React.createElement('Text', { testID: 'skeleton' }),
    PostCard: (props: { event: FeedEvent }) =>
      React.createElement('Text', { testID: `card-${props.event.content}` }, props.event.content),
  };
});
jest.mock('@/shared/ui/composed/EmptyState', () => {
  const React = require('react');
  return {
    EmptyState: (props: { title: string }) =>
      React.createElement('Text', { testID: 'feed-empty' }, props.title),
  };
});

// ── collaborators of the cards and screen furniture ──
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ useNDK: () => ({ ndk: {} }), NDKEvent: class {} }));
jest.mock('@/shared/lib/nostr/publish', () => ({ publishEvent: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ paramPopup: jest.fn(), actionMenuPopup: jest.fn() }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys.pubkey ? { pubkey: mockKeys.pubkey } : null }),
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
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: require('react-native').View }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: require('react-native').Pressable,
}));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('assets/icons', () => () => null);
jest.mock('heroui-native', () => {
  const Button = function Button() {
    return null;
  };
  Button.Label = function ButtonLabel() {
    return null;
  };
  return { Button };
});
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
jest.mock('../hooks/usePostActions', () => ({ usePostActions: () => jest.fn() }));
jest.mock('../hooks/useZap', () => ({ useZap: () => ({ openZapMenu: jest.fn() }) }));
jest.mock('../lib/useQuotePost', () => ({ useQuotePost: () => jest.fn() }));
jest.mock('../stores/ignoreStore', () => ({
  useFeedIgnoreStore: (select: (value: typeof mockIgnore) => unknown) => select(mockIgnore),
}));

const note = (content: string): FeedEvent => ({
  id: content.padEnd(64, '0'),
  pubkey: 'f'.repeat(64),
  kind: 1,
  created_at: 1,
  content,
  tags: [],
});

function feedPage(contents: string[], hasMore = true) {
  const orderedFeedItems: FeedItem[] = contents.map((c, i) => ({
    type: 'note',
    event: note(c),
    timestamp: 100 - i,
  }));
  return {
    orderedFeedItems,
    metricsMap: new Map(),
    quotedEventsMap: new Map(),
    profilesMap: new Map(),
    missingQuotedIds: [],
    missingProfilePubkeys: [],
    paginationUntil: 1,
    paginationOffset: contents.length,
    paginationCursor: hasMore ? { createdAt: 1, id: 'cursor' } : null,
    hasMore,
  };
}

const settle = () => act(async () => {});
const cards = () =>
  screen.queryAllByTestId(/^card-/).map((node) => String(node.props.testID).slice('card-'.length));
const skeletons = () => screen.queryAllByTestId('skeleton').length;
const emptyTitle = () => screen.queryByTestId('feed-empty')?.props.children ?? null;
const specOf = (pending: Pending) => JSON.parse(pending.request.spec).id as string;

async function answer(index: number, page: unknown) {
  await act(async () => mockRequests[index]!.resolve(page));
}

beforeEach(() => {
  mockRequests.length = 0;
  mockEnrich.held = false;
  mockEnrich.calls.length = 0;
  mockKeys.pubkey = 'viewer';
  mockIgnore.ignoredPubkeys = [];
  mockIgnore.ignoredEventIds = [];
  mockList.props = null;
  feedPageCache.clear();
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 0);
});

afterEach(() => jest.restoreAllMocks());

describe('first load', () => {
  it('shows skeleton rows, asks for the For you page, then shows its cards', async () => {
    render(<HomeFeed />);
    await settle();

    expect(skeletons()).toBe(5);
    expect(mockRequests).toHaveLength(1);
    expect(specOf(mockRequests[0]!)).toBe('for-you');
    expect(mockRequests[0]!.request).toMatchObject({ refresh: false, userPubkey: 'viewer' });

    await answer(0, feedPage(['one', 'two']));
    expect(skeletons()).toBe(0);
    expect(cards()).toEqual(['one', 'two']);
  });

  it('shows the unreachable state when the first load fails', async () => {
    render(<HomeFeed />);
    await settle();
    await act(async () => mockRequests[0]!.reject(new Error('offline')));

    expect(cards()).toEqual([]);
    expect(emptyTitle()).toBe("Can't reach your relays");
  });

  it('drops a superseded answer after a tab switch', async () => {
    const view = render(<HomeFeed activeFilter={FEED_FILTER_FOR_YOU} />);
    await settle();
    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOLLOWING_POPULAR} />);
    await settle();
    expect(specOf(mockRequests[1]!)).toBe('following-popular');

    await answer(0, feedPage(['late-for-you']));
    expect(cards()).toEqual([]);
    await answer(1, feedPage(['popular']));
    expect(cards()).toEqual(['popular']);
  });
});

describe('page cache', () => {
  it('paints a tab loaded in the last two minutes from the cache without asking again', async () => {
    const view = render(<HomeFeed activeFilter={FEED_FILTER_FOR_YOU} />);
    await settle();
    await answer(0, feedPage(['cached']));
    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOLLOWING_POPULAR} />);
    await settle();
    await answer(1, feedPage(['popular']));

    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOR_YOU} />);
    await settle();

    expect(mockRequests).toHaveLength(2);
    expect(cards()).toEqual(['cached']);
  });

  it('paints a cached tab older than two minutes, then asks again without skeletons', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const view = render(<HomeFeed activeFilter={FEED_FILTER_FOR_YOU} />);
    await settle();
    await answer(0, feedPage(['old']));
    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOLLOWING_POPULAR} />);
    await settle();
    await answer(1, feedPage(['popular']));

    clock.mockReturnValue(now + 3 * 60 * 1000);
    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOR_YOU} />);
    await settle();

    expect(cards()).toEqual(['old']);
    expect(skeletons()).toBe(0);
    expect(mockRequests).toHaveLength(3);
    expect(specOf(mockRequests[2]!)).toBe('for-you');
    await answer(2, feedPage(['new']));
    expect(cards()).toEqual(['new']);
  });
});

describe('refresh and load more', () => {
  it('keeps the cards while refreshing, asks with refresh, and ignores a second pull', async () => {
    render(<HomeFeed />);
    await settle();
    await answer(0, feedPage(['one']));

    await act(async () => mockPull.onRefresh());
    expect(mockPull.refreshing).toBe(true);
    expect(cards()).toEqual(['one']);
    expect(mockRequests[1]!.request).toMatchObject({ refresh: true });

    await act(async () => mockPull.onRefresh());
    expect(mockRequests).toHaveLength(2);

    await answer(1, feedPage(['fresh']));
    expect(mockPull.refreshing).toBe(false);
    expect(cards()).toEqual(['fresh']);
  });

  it('loads the next page at the end of the list and appends only unseen items', async () => {
    render(<HomeFeed />);
    await settle();
    await answer(0, feedPage(['one', 'two']));

    await act(async () => mockList.props!.onEndReached());
    expect(mockRequests[1]!.request).toMatchObject({
      loadMore: true,
      cursor: { createdAt: 1, id: 'cursor' },
    });
    await answer(1, feedPage(['two', 'three'], false));
    expect(cards()).toEqual(['one', 'two', 'three']);

    await act(async () => mockList.props!.onEndReached());
    expect(mockRequests).toHaveLength(2);
  });

  it('stays refreshing after a refresh is cut short by a switch to a fresh cached tab', async () => {
    const view = render(<HomeFeed activeFilter={FEED_FILTER_FOLLOWING_POPULAR} />);
    await settle();
    await answer(0, feedPage(['popular']));
    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOR_YOU} />);
    await settle();
    await answer(1, feedPage(['for-you']));

    await act(async () => mockPull.onRefresh());
    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOLLOWING_POPULAR} />);
    await settle();
    await answer(2, feedPage(['refreshed-for-you']));

    // QUIRK (F185): the cached paint returns without clearing the refresh
    // flag and drops the refresh's answer, so the spinner stays on and both
    // pull-to-refresh and load-more are blocked.
    expect(cards()).toEqual(['popular']);
    expect(mockPull.refreshing).toBe(true);
    const before = mockRequests.length;
    await act(async () => mockPull.onRefresh());
    await act(async () => mockList.props!.onEndReached());
    expect(mockRequests).toHaveLength(before);
  });
});

describe('viewer, preferences and remount', () => {
  it("loads the viewer's own feed once their keys arrive, from skeletons", async () => {
    mockKeys.pubkey = undefined;
    const view = render(<HomeFeed />);
    await settle();
    expect(mockRequests[0]!.request.userPubkey).toBeUndefined();
    await answer(0, feedPage(['host']));
    expect(cards()).toEqual(['host']);

    mockKeys.pubkey = 'viewer';
    view.rerender(<HomeFeed />);
    await settle();
    expect(skeletons()).toBe(5);
    expect(cards()).toEqual([]);
    expect(mockRequests[1]!.request).toMatchObject({ userPubkey: 'viewer', refresh: false });
    await answer(1, feedPage(['mine']));
    expect(cards()).toEqual(['mine']);
  });

  it('paints a fresh cached page on remount without asking again', async () => {
    const first = render(<HomeFeed />);
    await settle();
    await answer(0, feedPage(['one']));
    first.unmount();

    render(<HomeFeed />);
    expect(cards()).toEqual(['one']);
    expect(skeletons()).toBe(0);
    await settle();
    expect(mockRequests).toHaveLength(1);
  });

  it('a block while the page is fresh repaints page one from the cache without asking', async () => {
    const view = render(<HomeFeed />);
    await settle();
    await answer(0, feedPage(['one', 'two']));
    await act(async () => mockList.props!.onEndReached());
    await answer(1, feedPage(['three'], false));
    expect(cards()).toEqual(['one', 'two', 'three']);

    mockIgnore.ignoredEventIds = [note('two').id];
    view.rerender(<HomeFeed />);
    await settle();
    // The loaded-more page goes too: page one is applied again.
    expect(cards()).toEqual(['one']);
    expect(mockRequests).toHaveLength(2);
  });

  it('a block while the page is stale asks again without skeletons', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const view = render(<HomeFeed />);
    await settle();
    await answer(0, feedPage(['one', 'two']));

    clock.mockReturnValue(now + 3 * 60 * 1000);
    mockIgnore.ignoredEventIds = [note('two').id];
    view.rerender(<HomeFeed />);
    await settle();
    expect(cards()).toEqual(['one']);
    expect(skeletons()).toBe(0);
    expect(mockRequests).toHaveLength(2);
    expect(mockRequests[1]!.request).toMatchObject({ refresh: false });
  });
});

describe('refresh and load more meeting page one', () => {
  it('keeps the cards when a refresh fails, then pages from the top', async () => {
    render(<HomeFeed />);
    await settle();
    await answer(0, feedPage(['one', 'two']));

    await act(async () => mockPull.onRefresh());
    await act(async () => mockRequests[1]!.reject(new Error('offline')));
    expect(cards()).toEqual(['one', 'two']);
    expect(mockPull.refreshing).toBe(false);
    expect(emptyTitle()).toBeNull();

    // QUIRK: the refresh dropped the cursor before it failed, so the next page
    // is asked for from the top.
    await act(async () => mockList.props!.onEndReached());
    expect(mockRequests[2]!.request).toMatchObject({ loadMore: true, cursor: null });
  });

  it("cancels page one's enrichment when the next page is asked for", async () => {
    mockEnrich.held = true;
    render(<HomeFeed />);
    await settle();
    await answer(0, feedPage(['one']));
    expect(mockEnrich.calls).toHaveLength(1);

    await act(async () => mockList.props!.onEndReached());
    expect(mockRequests[1]!.request).toMatchObject({ loadMore: true });
    // QUIRK (F221): page one and the next page share one load, so asking for
    // the next page aborts page one's enrichment.
    expect(mockEnrich.calls[0]!.signal?.aborted).toBe(true);
  });

  it("cancels a stale page's revalidation when the next page is asked for", async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const view = render(<HomeFeed activeFilter={FEED_FILTER_FOR_YOU} />);
    await settle();
    await answer(0, feedPage(['old']));
    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOLLOWING_POPULAR} />);
    await settle();
    await answer(1, feedPage(['popular']));

    clock.mockReturnValue(now + 3 * 60 * 1000);
    view.rerender(<HomeFeed activeFilter={FEED_FILTER_FOR_YOU} />);
    await settle();
    expect(specOf(mockRequests[2]!)).toBe('for-you');

    await act(async () => mockList.props!.onEndReached());
    expect(mockRequests[3]!.request).toMatchObject({
      loadMore: true,
      cursor: { createdAt: 1, id: 'cursor' },
    });
    expect(mockRequests[2]!.request.signal?.aborted).toBe(true);
    await answer(3, feedPage(['older'], false));
    expect(cards()).toEqual(['old', 'older']);
    await answer(2, feedPage(['new']));
    expect(cards()).toEqual(['old', 'older']);
  });
});
