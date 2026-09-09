/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StoriesCarousel, type StoryUser } from '../components/nostr/StoriesCarousel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestPlayer = {
  url: string;
  currentTime: number;
  duration: number;
  timeUpdateEventInterval: number;
  play: jest.Mock;
  pause: jest.Mock;
  readTime: jest.Mock;
  listeners: Map<string, (event?: object) => void>;
};
let mockPlayers: TestPlayer[] = [];
jest.mock('expo-video', () => ({
  VideoView: 'VideoView',
  useVideoPlayer: (url: string, setup: (player: object) => void) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.useMemo(() => {
      const readTime = jest.fn(() => 0);
      const player = {
        url,
        duration: 10,
        timeUpdateEventInterval: 0,
        get currentTime() {
          return readTime();
        },
        set currentTime(_value: number) {},
        play: jest.fn(),
        pause: jest.fn(),
        readTime,
        listeners: new Map(),
      };
      setup(player);
      mockPlayers.push(player);
      return player;
    }, [url]);
  },
}));
jest.mock('expo', () => ({
  useEventListener: (player: TestPlayer, event: string, callback: (event?: object) => void) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    ReactActual.useEffect(() => {
      player.listeners.set(event, callback);
      return () => {
        player.listeners.delete(event);
      };
    }, [player, event, callback]);
  },
}));
jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const View = jest.requireActual<typeof import('react-native')>('react-native').View;
  return {
    __esModule: true,
    default: {
      View,
      FlatList: ({
        data,
        renderItem,
      }: {
        data: StoryUser[];
        renderItem: (args: { item: StoryUser; index: number }) => React.ReactNode;
      }) =>
        data.map((item, index) => (
          <ReactActual.Fragment key={item.pubkey}>
            {renderItem({ item, index })}
          </ReactActual.Fragment>
        )),
    },
    useSharedValue: (initial: unknown) =>
      ReactActual.useRef({
        value: initial,
        get() {
          return this.value;
        },
        set(value: unknown) {
          this.value = value;
        },
      }).current,
    useAnimatedReaction: jest.fn(),
    useAnimatedScrollHandler: jest.fn(),
    useAnimatedStyle: () => ({}),
    runOnJS: (callback: () => void) => callback,
    FadeIn: { duration: jest.fn() },
    FadeOut: { duration: jest.fn() },
  };
});
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('assets/icons', () => 'Icon');
jest.mock('../components/nostr/StoriesContainer', () => ({
  StoriesContainer: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('../components/nostr/StoryProgressBar', () => ({ StoryProgressBar: 'StoryProgressBar' }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/VisualLayoutProbe', () => ({
  VisualLayoutProbe: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useVisualListLogger: () => ({ onMetricsChange: jest.fn(), onViewableItemsChanged: jest.fn() }),
  remeasureVisualLayoutScope: jest.fn(),
  visualViewabilityRange: jest.fn(),
}));

const storyUsers: StoryUser[] = [
  {
    pubkey: 'fixture-author',
    videoPosts: [0, 1, 2].map((index) => ({
      eventId: `fixture-${index}`,
      pubkey: 'fixture-author',
      created_at: index,
      videoUrl: `https://example.com/story-${index}.mp4`,
      content: '',
    })),
  },
];
let renderer: TestRenderer.ReactTestRenderer;
let onClose: jest.Mock;
function current(): TestPlayer {
  return (
    renderer.root.findAllByProps({ contentFit: 'contain' })[0]?.props.player ??
    mockPlayers[mockPlayers.length - 1]
  );
}
beforeEach(() => {
  jest.useFakeTimers();
  mockPlayers = [];
  onClose = jest.fn();
  act(() => {
    renderer = TestRenderer.create(<StoriesCarousel storyUsers={storyUsers} onClose={onClose} />);
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('advances through all videos when the native player changes with each source', () => {
  expect(current().url).toContain('story-0');
  act(() => current().listeners.get('playToEnd')?.());
  expect(current().url).toContain('story-1');
  act(() => current().listeners.get('playToEnd')?.());
  expect(current().url).toContain('story-2');
  act(() => current().listeners.get('playToEnd')?.());
  act(() => jest.advanceTimersByTime(150));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('uses the time-update payload without a redundant synchronous native time read', () => {
  const player = current();
  act(() => player.listeners.get('timeUpdate')?.({ currentTime: 4 }));
  const bar = renderer.root.findAll(
    (node) => node.props.storyProgress && node.props.index === 0
  )[0];
  expect(bar.props.storyProgress.get()).toBe(0.4);
  expect(player.readTime).not.toHaveBeenCalled();
});

it('stops emitting time updates and does not advance while closing', () => {
  act(() =>
    renderer.update(<StoriesCarousel storyUsers={storyUsers} onClose={onClose} isClosing />)
  );
  expect(current().timeUpdateEventInterval).toBe(0);
  act(() => current().listeners.get('playToEnd')?.());
  expect(current().url).toContain('story-0');
});

it('cancels delayed close if the current media source changes before it fires', () => {
  for (let index = 0; index < 3; index += 1) {
    act(() => current().listeners.get('playToEnd')?.());
  }
  const updatedUsers = storyUsers.map((user) => ({
    ...user,
    videoPosts: user.videoPosts.map((post) => ({ ...post, videoUrl: `${post.videoUrl}?updated` })),
  }));
  act(() => renderer.update(<StoriesCarousel storyUsers={updatedUsers} onClose={onClose} />));
  expect(current().url).toContain('?updated');
  act(() => jest.advanceTimersByTime(150));
  expect(onClose).not.toHaveBeenCalled();
});

it('does not resume playback from a late press release during close', () => {
  const player = current();
  act(() =>
    renderer.update(<StoriesCarousel storyUsers={storyUsers} onClose={onClose} isClosing />)
  );
  player.play.mockClear();
  const surface = renderer.root.findAllByProps({ delayLongPress: 250 })[0];
  act(() => {
    surface.props.onPressOut();
  });
  expect(player.play).not.toHaveBeenCalled();
});
