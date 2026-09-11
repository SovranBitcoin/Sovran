/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoists module factories before static imports. */
import type { ReactNode } from 'react';
import { InteractionManager } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { PostCard } from '../components/nostr/PostCard';
import { ThreadScreen } from '../screens/ThreadScreen';
import { DEFAULT_METRICS, type FeedEvent } from '../components/nostr/feedTypes';
import { __resetGuardForTests } from '@/shared/hooks/useGuardedRouter';

const mockPush = jest.fn();
const mockGetThread = jest.fn();
let mockParams: { eventId: string };
const mockIgnored = { ignoredPubkeys: [], ignoredEventIds: [] };
const mockListProps: { initialScrollIndex?: number; data: { type: string }[] }[] = [];

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
}));

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
}));
jest.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => 80,
  HeaderHeightContext: require('react').createContext(80),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 20, left: 0, right: 0 }),
}));
jest.mock('@/shared/ui/composed/AndroidSheetRoot', () => ({
  SheetHeaderHeightContext: require('react').createContext(null),
}));
jest.mock('@/shared/ui/composed/FlowSheetHeader', () => ({ FLOW_SHEET_SCRIM_OVERHANG: 0 }));
jest.mock('@/shared/ui/composed/ModalLayoutWrapper', () => ({
  ModalLayoutWrapper: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: { View: require('react-native').View },
    FadeIn: { duration: () => ({}) },
    useSharedValue: (initial: number) =>
      React.useState(() => ({
        value: initial,
        get() {
          return this.value;
        },
        set(value: number) {
          this.value = value;
        },
      }))[0],
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withDelay: (_delay: number, value: unknown) => value,
    withTiming: (value: unknown) => value,
    Easing: { out: () => undefined, cubic: undefined },
  };
});
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children, gesture }: { children: ReactNode; gesture: () => void }) => {
    return require('react').createElement(
      'Pressable',
      { testID: 'post-tap', onPress: gesture },
      children
    );
  },
}));
jest.mock('../hooks/useCardTapGesture', () => ({
  useCardTapGesture: (onPress: () => void) => ({ gesture: onPress }),
}));
jest.mock('@shopify/flash-list', () => ({
  // Native measurement is not simulated. Exercise the real row renderer and
  // record the first data/anchor supplied to FlashList, before deferred work.
  FlashList: (props: { data: unknown[]; renderItem: (info: unknown) => ReactNode }) => {
    mockListProps.push(props as never);
    return props.data.map((item, index) =>
      require('react').createElement(
        require('react-native').View,
        { key: index },
        props.renderItem({ item, index })
      )
    );
  },
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: require('react-native').View }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: require('react-native').View }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: require('react-native').View }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: require('react-native').Pressable,
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: () => null }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('@/shared/ui/primitives/Skeleton', () => ({ Skeleton: () => null }));
jest.mock('@/shared/ui/composed/TierBadge', () => ({ TierBadge: () => null }));
jest.mock('@/shared/ui/composed/SkeletonExitShimmer', () => ({
  SkeletonExitReveal: ({ children }: { children: ReactNode }) => children,
  SkeletonLoadingShimmer: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('assets/icons', () => () => null);
jest.mock('../components/nostr/DeletedTombstone', () => ({ DeletedTombstone: () => null }));
jest.mock('../components/nostr/NoteContent', () => ({
  NoteContent: ({ content }: { content: string }) => {
    return require('react').createElement('Text', { testID: `note-${content}` }, content);
  },
  NOTE_CONTENT_FONT_SIZE: 16,
}));
jest.mock('../components/nostr/MetricsFooter', () => ({
  MetricsFooter: () => null,
  POST_ACTION_ICON_SIZES: { compact: { base: 16 }, regular: { base: 20 } },
}));
jest.mock('../components/nostr/image-overlay', () => ({
  ImageOverlayProvider: ({ children }: { children: ReactNode }) => children,
  useImageOverlay: () => null,
  AnimatedImageOverlay: () => null,
}));
jest.mock('../components/thread-embed', () => ({
  ThreadEmbedProvider: ({ children }: { children: ReactNode }) => children,
  ThreadEmbedSheet: ({ children }: { children: ReactNode }) => children,
  useThreadEmbed: () => null,
}));
jest.mock('../components/ThreadReplyBar', () => ({ ThreadReplyBar: () => null }));
jest.mock('../hooks/usePostActions', () => ({ usePostActions: () => jest.fn() }));
jest.mock('../hooks/useZap', () => ({ useZap: () => ({ openZapMenu: jest.fn() }) }));
jest.mock('../lib/replyTarget', () => ({ deriveReplyTarget: jest.fn() }));
jest.mock('../lib/useQuotePost', () => ({ useQuotePost: () => jest.fn() }));
jest.mock('@/features/composer/publish/useComposerActions', () => ({
  useOpenComposer: () => jest.fn(),
}));
jest.mock('../hooks/useNostrEngagement', () => ({
  useNostrEngagement: () => ({
    getDisplayMetrics: () => ({ likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 }),
    getEngagementState: () => ({}),
    getZapState: () => ({}),
    toggleLike: jest.fn(),
    toggleRepost: jest.fn(),
    engagementRevision: 0,
  }),
}));
jest.mock('@/shared/stores/profile/nostrSocialStore', () => ({
  selectIsDeleteRequested: () => () => false,
  useNostrSocialStore: () => false,
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  useProfile: () => ({ profile: { name: 'Known author' }, status: 'ready' }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (value: string | string[]) =>
    Array.isArray(value) ? value.map(() => 'black') : 'black',
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/lib/date', () => ({
  formatDate: () => '',
  formatRelativeUnixSeconds: () => '',
}));
jest.mock('@/shared/lib/popup', () => ({ actionMenuPopup: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  feedLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  paymentLog: { debug: jest.fn() },
  useLifecycleLogger: jest.fn(),
  Log: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../data/useFeedClient', () => ({ getFeedClient: () => ({ getThread: mockGetThread }) }));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ readThread: () => ({ root: null }) }),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'viewer' } }),
}));
jest.mock('../stores/ignoreStore', () => ({
  useFeedIgnoreStore: (select: (state: typeof mockIgnored) => unknown) => select(mockIgnored),
}));
jest.mock('@/shared/stores/profile/ownContentStore', () => ({
  useOwnContentStore: { getState: () => ({ getOwn: () => undefined }) },
  ingestOwnContent: jest.fn(),
}));
jest.mock('@/shared/stores/profile/ownedMediaStore', () => ({ ingestOwnMediaBlobs: jest.fn() }));

const parent: FeedEvent = {
  id: 'a'.repeat(64),
  pubkey: 'c'.repeat(64),
  kind: 1,
  created_at: 1,
  content: 'Known parent',
  tags: [],
};
const target: FeedEvent = {
  id: 'b'.repeat(64),
  pubkey: 'c'.repeat(64),
  kind: 1,
  created_at: 2,
  content: 'Clicked post',
  tags: [['e', parent.id, '', 'reply']],
};

beforeEach(() => {
  __resetGuardForTests();
  mockPush.mockReset();
  mockListProps.length = 0;
  mockGetThread.mockReset().mockImplementation(() => new Promise(() => {}));
  jest
    .spyOn(InteractionManager, 'runAfterInteractions')
    .mockImplementation(() => ({ cancel: jest.fn(), then: jest.fn(), done: jest.fn() }));
});
afterEach(() => jest.restoreAllMocks());

test('a real post tap mounts its known content at the top before deferred work', () => {
  const source = render(
    <PostCard
      variant="feed"
      event={target}
      metrics={DEFAULT_METRICS}
      quotedEvents={new Map()}
      profiles={new Map()}
      getMetrics={() => DEFAULT_METRICS}
      skipAnimation
      getThreadContext={() => ({
        allEvents: new Map([
          [parent.id, parent],
          [target.id, target],
        ]),
        profiles: new Map(),
        metrics: new Map(),
        quotedEvents: new Map(),
      })}
    />
  );
  fireEvent.press(source.getByTestId('post-tap'));
  fireEvent.press(source.getByTestId('post-tap'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  mockParams = mockPush.mock.calls[0][0].params;
  source.unmount();
  const destination = render(<ThreadScreen />);
  expect(destination.getByTestId('note-Clicked post')).toBeTruthy();
  expect(mockListProps[0].data[0].type).toBe('target');
  expect(mockListProps[0].initialScrollIndex).toBeUndefined();
  expect(mockGetThread).not.toHaveBeenCalled();
});
