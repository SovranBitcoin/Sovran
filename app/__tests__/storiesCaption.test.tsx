import { Dimensions } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useReducedMotion, withTiming } from 'react-native-reanimated';
import { StoryCaption } from '@/features/feed/components/nostr/stories/StoryCaption';
import { StoriesCarousel, type StoryUser } from '@/features/feed/components/nostr/StoriesCarousel';

jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@/assets/icons', () => 'Icon');
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('uniwind', () => ({ withUniwind: (component: unknown) => component }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }));
jest.mock('@/shared/ui/composed/ScrollEdgeFade', () => ({ ScrollEdgeFade: 'ScrollEdgeFade' }));
jest.mock('@/shared/lib/date', () => ({ formatRelative: () => '2h' }));
jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return { Log: 'Log', log: noop, storeLog: noop, feedLog: noop, redactError: (e: unknown) => e };
});
jest.mock('@/shared/ui/composed/VisualLayoutProbe', () => ({
  VisualLayoutProbe: 'VisualLayoutProbe',
}));
jest.mock('@/features/feed/components/nostr/StoriesContainer', () => ({
  StoriesContainer: 'StoriesContainer',
}));
jest.mock('@/features/feed/components/nostr/StoryProgressBar', () => ({
  StoryProgressBar: 'StoryProgressBar',
}));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useVisualListLogger: () => ({ onMetricsChange: jest.fn(), onViewableItemsChanged: jest.fn() }),
}));

const mockPlayer = { pause: jest.fn(), play: jest.fn(), currentTime: 0, duration: 20 };
const mockListeners: Record<string, (event: { currentTime?: number }) => void> = {};
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: 'VideoView' }));
jest.mock('expo', () => ({
  useEventListener: (
    _player: unknown,
    event: string,
    callback: (event: { currentTime?: number }) => void
  ) => {
    mockListeners[event] = callback;
  },
}));

let mockBegin: () => void;
let mockEnd: (event: { translationY: number; velocityY: number }) => void;
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: 'GestureDetector',
  Gesture: {
    Native: () => ({}),
    Pan: () => {
      const gesture = {
        enabled: () => gesture,
        activeOffsetY: () => gesture,
        failOffsetY: () => gesture,
        failOffsetX: () => gesture,
        simultaneousWithExternalGesture: () => gesture,
        onBegin: (callback: typeof mockBegin) => {
          mockBegin = callback;
          return gesture;
        },
        onEnd: (callback: typeof mockEnd) => {
          mockEnd = callback;
          return gesture;
        },
      };
      return gesture;
    },
  },
}));
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const transition = { duration: () => transition };
  return {
    __esModule: true,
    default: {
      View: 'AnimatedView',
      ScrollView: 'ScrollView',
      FlatList: ({
        data,
        renderItem,
      }: {
        data: StoryUser[];
        renderItem: (info: { item: StoryUser; index: number }) => React.ReactNode;
      }) =>
        React.createElement(
          React.Fragment,
          null,
          data.map((item, index) =>
            React.createElement(React.Fragment, { key: item.pubkey }, renderItem({ item, index }))
          )
        ),
    },
    useSharedValue: <T,>(initial: T) => {
      const value = React.useRef(initial);
      return React.useRef({
        get: () => value.current,
        set: (next: T) => {
          value.current = next;
        },
      }).current;
    },
    useAnimatedStyle: (factory: () => object) => factory(),
    useAnimatedScrollHandler: (handler: unknown) => handler,
    useAnimatedReaction: jest.fn(),
    useReducedMotion: jest.fn(() => false),
    withTiming: jest.fn((value: number) => value),
    runOnJS: (fn: unknown) => fn,
    LinearTransition: transition,
    FadeIn: transition,
    FadeOut: transition,
  };
});

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Dimensions.set({
    window: { width: 400, height: 800, scale: 1, fontScale: 1 },
    screen: { width: 400, height: 800, scale: 1, fontScale: 1 },
  });
});
let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useReducedMotion).mockReturnValue(false);
});
afterEach(() => {
  act(() => renderer?.unmount());
});

function layoutText(lineCount: number) {
  act(() => {
    renderer.root
      .findAll((node) => typeof node.props.onTextLayout === 'function')[0]
      .props.onTextLayout({
        nativeEvent: {
          lines: Array.from({ length: lineCount }, (_, i) => ({ y: i * 20, height: 20 })),
        },
      });
  });
}
function press(testID: string, event = {}) {
  act(() => {
    renderer.root.findByProps({ testID }).props.onPress(event);
  });
}

it('offers more only after measured overflow, with hidden measurement excluded from accessibility', () => {
  const change = jest.fn();
  act(() => {
    renderer = create(
      <StoryCaption caption="A caption" expanded={false} onExpandedChange={change} />
    );
  });
  expect(renderer.root.findAllByProps({ testID: 'story-caption-more' })).toHaveLength(0);
  layoutText(3);
  expect(renderer.root.findAllByProps({ testID: 'story-caption-more' })).toHaveLength(0);
  layoutText(4);
  expect(renderer.root.findByProps({ testID: 'story-caption' }).props.accessibilityState).toEqual({
    expanded: false,
  });
  expect(renderer.root.findAllByProps({ accessibilityElementsHidden: true })).toHaveLength(1);
  press('story-caption-more');
  expect(change).toHaveBeenCalledWith(true);
});

it.each([false, true])(
  'caps expanded height and supports collapse with reduced motion = %s',
  (reduced) => {
    jest.mocked(useReducedMotion).mockReturnValue(reduced);
    const change = jest.fn();
    act(() => {
      renderer = create(<StoryCaption caption="Long caption" expanded onExpandedChange={change} />);
    });
    layoutText(30);
    expect(withTiming).toHaveBeenLastCalledWith(360, { duration: reduced ? 0 : 280 });
    expect(renderer.root.findByProps({ testID: 'story-caption-scroll' }).props.scrollEnabled).toBe(
      true
    );
    expect(renderer.root.findAllByProps({ testID: 'story-caption-more' })).toHaveLength(0);
    press('story-caption');
    expect(change).toHaveBeenCalledWith(false);
  }
);

it('collapses on a downward flick at the top, preserving reading scrolls and short drags', () => {
  const change = jest.fn();
  act(() => {
    renderer = create(<StoryCaption caption="Long caption" expanded onExpandedChange={change} />);
  });
  layoutText(30);
  act(() => {
    mockBegin();
    mockEnd({ translationY: 5, velocityY: 0 });
  });
  expect(change).not.toHaveBeenCalled();
  act(() => {
    mockBegin();
    mockEnd({ translationY: -100, velocityY: -1500 });
  });
  expect(change).not.toHaveBeenCalled();
  act(() => {
    mockBegin();
    mockEnd({ translationY: 15, velocityY: 1200 });
  });
  expect(change).toHaveBeenCalledWith(false);
  change.mockClear();
  act(() => {
    renderer.root
      .findByProps({ testID: 'story-caption-scroll' })
      .props.onScroll({ contentOffset: { y: 100 } });
  });
  act(() => {
    mockBegin();
    mockEnd({ translationY: 180, velocityY: 1200 });
  });
  expect(change).not.toHaveBeenCalled();
});

const user: StoryUser = {
  pubkey: 'fictional-story-reader',
  profile: { name: 'Demo reader' },
  videoPosts: [0, 1].map((index) => ({
    eventId: `fictional-story-${index}`,
    pubkey: 'fictional-story-reader',
    videoUrl: `https://example.com/${index}.mp4`,
    content: `Story ${index} caption\nhttps://example.com/${index}.mp4`,
    created_at: 1,
  })),
};

it('pauses playback and progress while reading, collapses on video tap, and resets for the next story', () => {
  const close = jest.fn();
  act(() => {
    renderer = create(<StoriesCarousel storyUsers={[user]} onClose={close} />);
  });
  layoutText(5);
  const progress = renderer.root.findAll((node) => String(node.type) === 'StoryProgressBar')[0]
    .props.storyProgress;
  act(() => mockListeners.timeUpdate({ currentTime: 4 }));
  expect(progress.get()).toBe(0.2);
  press('story-caption-more');
  expect(mockPlayer.pause).toHaveBeenCalled();
  mockPlayer.play.mockClear();
  act(() => {
    mockListeners.timeUpdate({ currentTime: 5 });
    mockListeners.playToEnd({});
    renderer.root.findByProps({ testID: 'story-video' }).props.onPressOut();
  });
  expect(progress.get()).toBe(0.2);
  expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(renderer.root.findByType(StoryCaption).props.caption).toBe('Story 0 caption');
  press('story-video', { nativeEvent: { pageX: 350 } });
  expect(renderer.root.findByType(StoryCaption).props.expanded).toBe(false);
  expect(renderer.root.findByType(StoryCaption).props.caption).toBe('Story 0 caption');
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  act(() => mockListeners.timeUpdate({ currentTime: 6 }));
  expect(progress.get()).toBe(0.3);
  press('story-video', { nativeEvent: { pageX: 350 } });
  expect(renderer.root.findByType(StoryCaption).props.caption).toBe('Story 1 caption');
  expect(renderer.root.findByType(StoryCaption).props.expanded).toBe(false);
  expect(progress.get()).toBe(0);
  press('story-close');
  expect(close).toHaveBeenCalledTimes(1);
});

it('omits media-only captions and unmounts video/caption on close', () => {
  const mediaOnlyUser = {
    ...user,
    videoPosts: [{ ...user.videoPosts[0], content: user.videoPosts[0].videoUrl }],
  };
  act(() => {
    renderer = create(<StoriesCarousel storyUsers={[mediaOnlyUser]} />);
  });
  expect(renderer.root.findAllByType(StoryCaption)).toHaveLength(0);
  act(() => renderer.update(<StoriesCarousel storyUsers={[user]} isClosing />));
  expect(renderer.root.findAllByType(StoryCaption)).toHaveLength(0);
  expect(renderer.root.findAll((node) => String(node.type) === 'VideoView')).toHaveLength(0);
});
